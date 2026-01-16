
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    onAuthStateChanged, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut, 
    User 
} from 'firebase/auth';
import {
    getFirestore,
    collection,
    doc,
    setDoc,
    serverTimestamp,
    query,
    where,
    onSnapshot,
    deleteDoc,
    addDoc,
} from 'firebase/firestore';
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL,
} from 'firebase/storage';

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyDT9WDzU6HMO7_-qk9Kl4jc9JigiN9_JiI",
  authDomain: "muziq-slides.firebaseapp.com",
  projectId: "muziq-slides",
  storageBucket: "muziq-slides.firebasestorage.app",
  messagingSenderId: "577247718021",
  appId: "1:1034458390234:web:e0585b9aad338501797ec",
  measurementId: "G-SKRCL4J4GD"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// --- JWT UTILITY FOR APPLE MUSIC ---
/**
 * Generates an Apple Music Developer Token (JWT) using the ES256 algorithm.
 * Uses the Web Crypto API to avoid external library bloat.
 */
async function generateAppleMusicJWT(keyId: string, teamId: string, privateKeyPEM: string): Promise<string> {
    const header = { alg: 'ES256', kid: keyId };
    const payload = {
        iss: teamId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (3600 * 24 * 30), // Valid for 30 days
    };

    const base64Url = (obj: object) => 
        window.btoa(JSON.stringify(obj))
            .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const tokenParts = `${base64Url(header)}.${base64Url(payload)}`;

    try {
        // Clean PEM and convert to binary
        const pemContents = privateKeyPEM
            .replace(/-----BEGIN PRIVATE KEY-----/g, "")
            .replace(/-----END PRIVATE KEY-----/g, "")
            .replace(/\s/g, "");
        const binaryDer = Uint8Array.from(window.atob(pemContents), c => c.charCodeAt(0));

        // Import key for ECDSA P-256
        const key = await window.crypto.subtle.importKey(
            "pkcs8",
            binaryDer,
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["sign"]
        );

        // Sign the token
        const signature = await window.crypto.subtle.sign(
            { name: "ECDSA", hash: { name: "SHA-256" } },
            key,
            new TextEncoder().encode(tokenParts)
        );

        const base64UrlSignature = window.btoa(String.fromCharCode(...new Uint8Array(signature)))
            .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

        return `${tokenParts}.${base64UrlSignature}`;
    } catch (e) {
        console.error("JWT Generation Failed:", e);
        throw new Error("Could not sign Apple Music Token. Verify your authToken/keyId/teamId.");
    }
}

// --- TYPE DEFINITIONS ---
interface MediaFile {
  id: string;
  type: 'image' | 'video';
  file?: File;
  previewUrl: string;
  caption: string;
  duration?: number;
  timelineStart?: number;
  timelineEnd?: number;
}

interface AppStateAudio {
    id: string;
    file?: File;
    name: string;
    duration: number;
    startTime: number;
    fadeIn: number;
    fadeOut: number;
    previewUrl: string; 
    source: 'local' | 'apple-music';
    appleMusicTrackId?: string;
    demoAudioUrl?: string; 
}

interface SlideshowSettings {
    interval: number;
    slideStyle: string;
    showClock: boolean;
    smartCaptionsEnabled: boolean;
    repeatSlideshow: boolean;
    showCaptions: boolean;
    autoFadeEnabled: boolean;
    autoFadeInterval: number;
    muteVideos: boolean;
}

interface SavedSlideshow {
    id: string; 
    userId: string;
    name: string;
    media: any[];
    audio: any[];
    settings: SlideshowSettings;
    timestamp?: any;
    totalDuration?: number;
}

// --- SUB-COMPONENTS ---
const AppleMusicPlayer: React.FC<{
    trackId: string;
    active: boolean;
    volume: number;
    startTimeInFile: number;
    isDemo?: boolean;
    demoAudioUrl?: string;
}> = ({ trackId, active, volume, startTimeInFile, isDemo, demoAudioUrl }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const lastVolumeRef = useRef(volume);

    useEffect(() => {
        if (isDemo && demoAudioUrl) {
            const audio = audioRef.current;
            if (!audio) return;
            if (active) {
                if (audio.paused) audio.play().catch(() => {});
                if (Math.abs(audio.currentTime - startTimeInFile) > 0.5) audio.currentTime = startTimeInFile;
            } else { if (!audio.paused) audio.pause(); }
            return;
        }
        const music = (window as any).MusicKit?.getInstance();
        if (!music || isDemo) return;
        if (active) {
            music.setQueue({ song: trackId }).then(() => {
                if (music.playbackState !== 2) music.play();
                if (Math.abs(music.currentPlaybackTime - startTimeInFile) > 1.0) music.seekToTime(startTimeInFile);
            }).catch(console.error);
        } else if (music.nowPlayingItem?.id === trackId) { music.pause(); }
    }, [active, trackId, startTimeInFile, isDemo, demoAudioUrl]);

    useEffect(() => {
        const audio = isDemo ? audioRef.current : (window as any).MusicKit?.getInstance();
        if (!audio) return;
        if (Math.abs(lastVolumeRef.current - volume) > 0.01) {
            audio.volume = Math.max(0, Math.min(1, volume));
            lastVolumeRef.current = volume;
        }
    }, [volume, isDemo]);

    return isDemo && demoAudioUrl ? <audio ref={audioRef} src={demoAudioUrl} preload="auto" /> : null;
};

const TheaterMedia: React.FC<{
    media: MediaFile;
    isVisible: boolean;
    elapsedTime: number;
    slideStyle: string;
}> = ({ media, isVisible, slideStyle }) => (
    <div className={`w-full h-full absolute inset-0 flex items-center justify-center transition-opacity duration-700 ${isVisible ? 'opacity-100 z-20' : 'opacity-0 z-10'}`}>
        <div className={`w-full h-full flex items-center justify-center animate-${isVisible ? slideStyle : 'none'}`}>
            {media.type === 'image' ? <img src={media.previewUrl} className="w-full h-full object-contain" alt="slide" /> : <video src={media.previewUrl} className="w-full h-full object-contain" autoPlay muted loop />}
        </div>
    </div>
);

const AudioPlayer: React.FC<{ src: string; active: boolean; volume: number; startTimeInFile: number; }> = ({ src, active, volume, startTimeInFile }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (active) {
            if (audio.paused) audio.play().catch(() => {});
            if (Math.abs(audio.currentTime - startTimeInFile) > 0.5) audio.currentTime = startTimeInFile;
        } else { if (!audio.paused) audio.pause(); }
    }, [active, startTimeInFile]);
    useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);
    return <audio ref={audioRef} src={src} preload="auto" />;
};

// --- MAIN APP ---
const App: React.FC = () => {
    const [user, setUser] = useState<User | null>(null);
    const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
    const [audioFiles, setAudioFiles] = useState<AppStateAudio[]>([]);
    const [settings, setSettings] = useState<SlideshowSettings>({
        interval: 5, slideStyle: 'ken-burns', showClock: true, smartCaptionsEnabled: false, repeatSlideshow: false, showCaptions: true, autoFadeEnabled: false, autoFadeInterval: 3, muteVideos: false,
    });
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [elapsedTime, setElapsedTime] = useState(0); 
    const [slideshowName, setSlideshowName] = useState('');
    const [ownedSlideshows, setOwnedSlideshows] = useState<SavedSlideshow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Initialize Gemini API client as per instructions
    const ai = useMemo(() => new GoogleGenAI({ apiKey: process.env.API_KEY }), []);
    
    // --- APPLE MUSIC ---
    const [isMusicBrowserOpen, setIsMusicBrowserOpen] = useState(false);
    const [appleMusicAuthorized, setAppleMusicAuthorized] = useState(false);
    const [isDemoMode, setIsDemoMode] = useState(false);
    const [developerToken, setDeveloperToken] = useState<string>('APPLE_MUSIC_DEVELOPER_TOKEN');
    const [showTokenSettings, setShowTokenSettings] = useState(false);
    const [appleMusicPlaylists, setAppleMusicPlaylists] = useState<any[]>([]);
    const [appleMusicTracks, setAppleMusicTracks] = useState<any[]>([]);

    const requestRef = useRef<number>(0);
    const startTimeRef = useRef<number>(0);
    const lastTickTimeRef = useRef<number>(0);

    // AUTO-GENERATE TOKEN ON STARTUP
    useEffect(() => {
        const teamId = (process.env as any).TEAM_ID;
        const keyId = (process.env as any).KEY_ID;
        const authToken = (process.env as any).AUTH_TOKEN;

        if (teamId && keyId && authToken) {
            generateAppleMusicJWT(keyId, teamId, authToken)
                .then(token => {
                    setDeveloperToken(token);
                    return (window as any).MusicKit.configure({
                        developerToken: token,
                        app: { name: 'Muziq Slides', build: '1.0.3' }
                    });
                })
                .then(music => setAppleMusicAuthorized(music.isAuthorized))
                .catch(e => {
                    console.error("Automatic MusicKit setup failed:", e);
                    setError("Apple Music automatic setup failed. Please check environment variables.");
                });
        }
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => { 
            setUser(u); 
            setIsLoading(false); 
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        if (!user) return;
        const q = query(collection(db, "slideshows"), where("userId", "==", user.uid));
        return onSnapshot(q, (snap) => {
            setOwnedSlideshows(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow)));
        });
    }, [user]);

    const mediaWithTimestamps = useMemo(() => {
        let currentPos = 0;
        return mediaFiles.map(m => {
            const start = currentPos;
            const dur = m.type === 'image' ? settings.interval : (m.duration || 0);
            currentPos += dur;
            return { ...m, timelineStart: start, timelineEnd: currentPos };
        });
    }, [mediaFiles, settings.interval]);

    const totalSlideshowDuration = useMemo(() => 
        mediaWithTimestamps.length > 0 ? mediaWithTimestamps[mediaWithTimestamps.length - 1].timelineEnd! : 0
    , [mediaWithTimestamps]);

    const animate = useCallback((time: number) => {
        if (!startTimeRef.current) { startTimeRef.current = time; lastTickTimeRef.current = time; }
        const delta = (time - lastTickTimeRef.current) / 1000;
        lastTickTimeRef.current = time;
        setElapsedTime(prev => {
            let next = prev + delta;
            if (next >= totalSlideshowDuration) {
                if (settings.repeatSlideshow) return 0;
                setIsPlaying(false); return totalSlideshowDuration;
            }
            return next;
        });
        requestRef.current = requestAnimationFrame(animate);
    }, [totalSlideshowDuration, settings.repeatSlideshow]);

    useEffect(() => {
        if (isPlaying) requestRef.current = requestAnimationFrame(animate);
        else cancelAnimationFrame(requestRef.current);
        return () => cancelAnimationFrame(requestRef.current);
    }, [isPlaying, animate]);

    useEffect(() => {
        const activeIdx = mediaWithTimestamps.findIndex(m => elapsedTime >= m.timelineStart! && elapsedTime < m.timelineEnd!);
        if (activeIdx !== -1 && activeIdx !== currentSlide) setCurrentSlide(activeIdx);
    }, [elapsedTime, mediaWithTimestamps, currentSlide]);

    const authorizeAppleMusic = async () => {
        const music = (window as any).MusicKit?.getInstance();
        if (!music) { setError("MusicKit not initialized."); return; }
        try {
            await music.authorize(); setAppleMusicAuthorized(true);
            const playlists = await music.api.library.playlists();
            setAppleMusicPlaylists(playlists || []);
        } catch (e: any) { setError(`Auth failed: ${e.message}`); }
    };

    if (isLoading) return <div className="min-h-screen bg-brand-dark flex items-center justify-center"><div className="w-8 h-8 border-2 border-brand-purple border-t-transparent rounded-full animate-spin"></div></div>;

    return (
        <div className={`min-h-screen font-sans ${user ? 'bg-brand-dark text-gray-200' : 'bg-white text-gray-900'}`}>
            <header className="p-4 flex justify-between items-center border-b border-gray-800 bg-gray-900/50 sticky top-0 z-40 backdrop-blur-md">
                <h1 className="text-xl font-bold tracking-tight text-white"><span className="text-brand-purple">Muziq</span> Slides</h1>
                <div>{user ? <button onClick={() => signOut(auth)} className="text-xs bg-brand-purple px-4 py-2 rounded-lg font-bold">Logout</button> : <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="text-xs bg-brand-purple px-4 py-2 rounded-lg font-bold text-white">Sign In</button>}</div>
            </header>

            {!user ? (
                <main className="text-center pt-20 px-4">
                    <h2 className="text-4xl font-extrabold mb-4 tracking-tighter">Your Library, Your <span className="text-brand-purple">Stories</span></h2>
                    <p className="text-gray-500 mb-8 max-w-md mx-auto">Create beautiful slideshows with your photo library and Apple Music collection.</p>
                    <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="bg-brand-purple text-white px-8 py-3 rounded-full font-bold shadow-xl">Start Creating</button>
                </main>
            ) : (
                <main className="p-4 max-w-6xl mx-auto grid lg:grid-cols-2 gap-8">
                    <div className="space-y-6">
                        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 p-4 rounded-xl text-xs flex justify-between items-center"><span>{error}</span><button onClick={() => setError(null)}>X</button></div>}
                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-sm font-bold uppercase mb-4 text-brand-purple tracking-widest">1. Media Library</h3>
                            <input type="file" multiple accept="image/*,video/*" onChange={async (e) => {
                                if (!e.target.files) return;
                                // Fix for line 364 errors: Explicitly type 'files' as File[] to avoid 'unknown' inference for map elements
                                const files = Array.from(e.target.files).slice(0, 20) as File[];
                                const resolved = files.map(f => ({ 
                                    id: Math.random().toString(), 
                                    previewUrl: URL.createObjectURL(f), 
                                    type: f.type.startsWith('image') ? 'image' : 'video', 
                                    caption: '' 
                                } as MediaFile));
                                setMediaFiles(p => [...p, ...resolved]);
                            }} className="text-xs file:bg-gray-700 file:border-none file:text-white file:px-4 file:py-2 file:rounded-lg cursor-pointer" />
                        </section>
                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-sm font-bold uppercase mb-4 text-brand-purple tracking-widest">2. Soundtrack</h3>
                            <button onClick={() => setIsMusicBrowserOpen(true)} className="w-full bg-apple-red/10 py-3 rounded-xl text-xs font-bold text-apple-red border border-apple-red/30">Browse Apple Music</button>
                            <div className="mt-4 space-y-2">{audioFiles.map(a => <div key={a.id} className="bg-gray-900 p-2 rounded text-[10px] flex justify-between items-center">{a.name} <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))}>🗑️</button></div>)}</div>
                        </section>
                    </div>

                    <div className="space-y-6">
                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-sm font-bold uppercase mb-4">3. Preview</h3>
                            <div className="aspect-video bg-black rounded-2xl relative overflow-hidden flex items-center justify-center border border-gray-700/50">
                                {mediaFiles.length > 0 ? <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="bg-brand-purple p-6 rounded-full shadow-2xl">Play</button> : <p className="text-gray-600 text-[10px] uppercase font-bold tracking-widest">Empty Workspace</p>}
                            </div>
                        </section>
                    </div>
                </main>
            )}

            {/* Apple Music Modal */}
            {isMusicBrowserOpen && (
                <div className="fixed inset-0 bg-black/95 z-[200] flex items-center justify-center p-4 backdrop-blur-md">
                    <div className="bg-gray-900 w-full max-w-2xl h-[70vh] rounded-[2rem] border border-gray-800 flex flex-col overflow-hidden">
                        <header className="p-6 border-b border-gray-800 flex justify-between items-center">
                            <h2 className="font-bold text-apple-red uppercase tracking-tight">Apple Music Library</h2>
                            <button onClick={() => setIsMusicBrowserOpen(false)}>X</button>
                        </header>
                        {!appleMusicAuthorized ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-8">
                                <p className="text-xs text-gray-500 mb-6 text-center max-w-xs">Authorize to sync your production playlists. This uses your Render environment variables automatically.</p>
                                <button onClick={authorizeAppleMusic} className="bg-apple-red text-white py-3 px-10 rounded-full font-bold uppercase text-xs">Authorize Now</button>
                            </div>
                        ) : (
                            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                {appleMusicPlaylists.map(p => (
                                    <div key={p.id} className="bg-gray-800 p-4 rounded-xl flex justify-between items-center cursor-pointer hover:bg-gray-700 transition-colors" onClick={async () => {
                                        const tracks = await (window as any).MusicKit.getInstance().api.library.playlist(p.id);
                                        setAppleMusicTracks(tracks.relationships.tracks.data);
                                    }}>
                                        <span className="text-xs font-bold truncate">{p.attributes.name}</span>
                                        <span className="text-[10px] text-gray-500 uppercase tracking-widest">Playlist</span>
                                    </div>
                                ))}
                                {appleMusicTracks.length > 0 && <div className="mt-8 border-t border-gray-800 pt-4"><h4 className="text-[10px] uppercase font-black mb-4">Tracks</h4>{appleMusicTracks.map(t => (
                                    <div key={t.id} className="p-2 text-[10px] flex justify-between hover:bg-gray-800 rounded">{t.attributes.name} <button onClick={() => {
                                        setAudioFiles(p => [...p, { id: t.id, name: t.attributes.name, duration: t.attributes.durationInMillis/1000, startTime: 0, fadeIn: 1, fadeOut: 1, source: 'apple-music', appleMusicTrackId: t.id, previewUrl: '' }]);
                                        setIsMusicBrowserOpen(false);
                                    }} className="text-apple-red">+</button></div>
                                ))}</div>}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* THEATER MODE */}
            {isPlaying && (
                <div className="fixed inset-0 bg-black z-[100] flex flex-col items-center justify-center">
                    <button onClick={() => setIsPlaying(false)} className="absolute top-8 right-8 text-white/50 hover:text-white p-2 z-[110]">Exit</button>
                    <div className="w-full h-full relative flex items-center justify-center overflow-hidden">
                        {mediaWithTimestamps.map((m, idx) => (
                            <TheaterMedia key={m.id} media={m} isVisible={idx === currentSlide} elapsedTime={elapsedTime} slideStyle={settings.slideStyle} />
                        ))}
                    </div>
                    {audioFiles.map(a => {
                        const active = elapsedTime >= a.startTime && elapsedTime < (a.startTime + a.duration);
                        return a.source === 'apple-music' ? 
                            <AppleMusicPlayer key={a.id} trackId={a.appleMusicTrackId!} active={active} volume={1} startTimeInFile={elapsedTime - a.startTime} isDemo={isDemoMode} /> :
                            <AudioPlayer key={a.id} src={a.previewUrl} active={active} volume={1} startTimeInFile={elapsedTime - a.startTime} />
                    })}
                </div>
            )}
        </div>
    );
};

export default App;
