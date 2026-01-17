
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
    getDoc,
    setDoc,
    serverTimestamp,
    query,
    where,
    onSnapshot,
    deleteDoc,
} from 'firebase/firestore';

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

// --- JWT UTILITY FOR APPLE MUSIC ---
async function generateAppleMusicJWT(keyId: string, teamId: string, privateKeyPEM: string): Promise<string> {
    const header = { alg: 'ES256', kid: keyId };
    const payload = {
        iss: teamId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (3600 * 24 * 30),
    };
    const base64Url = (obj: object) => 
        window.btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const tokenParts = `${base64Url(header)}.${base64Url(payload)}`;
    try {
        const pemContents = privateKeyPEM.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
        const binaryDer = Uint8Array.from(window.atob(pemContents), c => c.charCodeAt(0));
        const key = await window.crypto.subtle.importKey("pkcs8", binaryDer, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
        const signature = await window.crypto.subtle.sign({ name: "ECDSA", hash: { name: "SHA-256" } }, key, new TextEncoder().encode(tokenParts));
        const base64UrlSignature = window.btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        return `${tokenParts}.${base64UrlSignature}`;
    } catch (e) {
        throw new Error("Could not sign Apple Music Token.");
    }
}

// --- TYPE DEFINITIONS ---
interface MediaFile {
  id: string;
  type: 'image' | 'video';
  previewUrl: string;
  caption: string;
  duration?: number;
  timelineStart?: number;
  timelineEnd?: number;
  base64?: string; 
}

interface AppStateAudio {
    id: string;
    name: string;
    duration: number;
    startTime: number;
    previewUrl: string; 
    source: 'local' | 'apple-music';
    appleMusicTrackId?: string;
}

interface SlideshowSettings {
    interval: number;
    slideStyle: string;
    repeatSlideshow: boolean;
    showCaptions: boolean;
}

interface SavedSlideshow {
    id: string; 
    userId: string;
    name: string;
    media: MediaFile[];
    audio: AppStateAudio[];
    settings: SlideshowSettings;
    timestamp?: any;
}

// --- SUB-COMPONENTS ---
const TheaterMedia: React.FC<{
    media: MediaFile;
    isVisible: boolean;
    slideStyle: string;
    showCaptions: boolean;
}> = ({ media, isVisible, slideStyle, showCaptions }) => {
    const animationClass = isVisible ? `animate-${slideStyle}` : 'opacity-0 pointer-events-none';
    
    return (
        <div className={`w-full h-full absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-700 ${isVisible ? 'opacity-100 z-20' : 'opacity-0 z-10'}`}>
            <div className={`w-full h-full flex items-center justify-center ${animationClass}`}>
                {media.type === 'image' ? (
                    <img src={media.previewUrl} className="w-full h-full object-contain" alt="slide" />
                ) : (
                    <video src={media.previewUrl} className="w-full h-full object-contain" autoPlay muted loop />
                )}
            </div>
            {showCaptions && media.caption && isVisible && (
                <div className="absolute bottom-12 left-0 right-0 text-center z-30">
                    <span className="bg-black/60 text-white px-6 py-2 rounded-full text-lg font-medium backdrop-blur-sm animate-fade-in">
                        {media.caption}
                    </span>
                </div>
            )}
        </div>
    );
};

const AppleMusicPlayer: React.FC<{ trackId: string; active: boolean; startTimeInFile: number; }> = ({ trackId, active, startTimeInFile }) => {
    useEffect(() => {
        const music = (window as any).MusicKit?.getInstance();
        if (!music) return;
        if (active) {
            music.setQueue({ song: trackId }).then(() => {
                if (music.playbackState !== 2) music.play();
                if (Math.abs(music.currentPlaybackTime - startTimeInFile) > 1.0) music.seekToTime(startTimeInFile);
            }).catch(console.error);
        } else if (music.nowPlayingItem?.id === trackId) {
            music.pause();
        }
    }, [active, trackId, startTimeInFile]);
    return null;
};

const AudioPlayer: React.FC<{ src: string; active: boolean; startTimeInFile: number; }> = ({ src, active, startTimeInFile }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (active) {
            if (audio.paused) audio.play().catch(() => {});
            if (Math.abs(audio.currentTime - startTimeInFile) > 0.5) audio.currentTime = startTimeInFile;
        } else {
            if (!audio.paused) audio.pause();
        }
    }, [active, startTimeInFile]);
    return <audio ref={audioRef} src={src} preload="auto" />;
};

// --- MAIN APP ---
const App: React.FC = () => {
    const [user, setUser] = useState<User | null>(null);
    const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
    const [audioFiles, setAudioFiles] = useState<AppStateAudio[]>([]);
    const [settings, setSettings] = useState<SlideshowSettings>({
        interval: 5, 
        slideStyle: 'ken-burns', 
        repeatSlideshow: false, 
        showCaptions: true,
    });
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [elapsedTime, setElapsedTime] = useState(0); 
    const [slideshowName, setSlideshowName] = useState('');
    const [ownedSlideshows, setOwnedSlideshows] = useState<SavedSlideshow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessingCaptions, setIsProcessingCaptions] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isMusicBrowserOpen, setIsMusicBrowserOpen] = useState(false);
    const [appleMusicAuthorized, setAppleMusicAuthorized] = useState(false);
    
    const requestRef = useRef<number>(0);
    const startTimeRef = useRef<number>(0);
    const lastTickTimeRef = useRef<number>(0);

    const ai = useMemo(() => new GoogleGenAI({ apiKey: process.env.API_KEY }), []);

    // Initial load and check for shared ID
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => { 
            setUser(u); 
            setIsLoading(false); 
        });
        
        const params = new URLSearchParams(window.location.search);
        const sharedId = params.get('id');
        if (sharedId) {
            loadSharedSlideshow(sharedId);
        }

        return unsubscribe;
    }, []);

    const loadSharedSlideshow = async (id: string) => {
        const docRef = doc(db, "slideshows", id);
        try {
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data() as SavedSlideshow;
                loadProject(data);
                setIsPlaying(true);
            }
        } catch (e) {
            setError("Failed to load shared slideshow.");
        }
    };

    const loadProject = (project: SavedSlideshow) => {
        if (!project) return;
        
        // RECONSTRUCT MEDIA: Blob URLs expire, so we must use base64 if available to restore previews
        const restoredMedia = (Array.isArray(project.media) ? project.media : []).map(m => {
            if (m.base64 && (!m.previewUrl || m.previewUrl.startsWith('blob:'))) {
                return { ...m, previewUrl: `data:image/jpeg;base64,${m.base64}` };
            }
            return m;
        });

        setMediaFiles(restoredMedia);
        setAudioFiles(Array.isArray(project.audio) ? project.audio : []);
        setSettings(project.settings || { interval: 5, slideStyle: 'ken-burns', repeatSlideshow: false, showCaptions: true });
        setSlideshowName(project.name || '');
        setElapsedTime(0);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Apple Music setup
    useEffect(() => {
        const teamId = (process.env as any).TEAM_ID;
        const keyId = (process.env as any).KEY_ID;
        const authToken = (process.env as any).AUTH_TOKEN;

        if (teamId && keyId && authToken) {
            generateAppleMusicJWT(keyId, teamId, authToken)
                .then(token => (window as any).MusicKit.configure({
                    developerToken: token,
                    app: { name: 'Muziq Slides', build: '1.0.3' }
                }))
                .then(music => setAppleMusicAuthorized(music.isAuthorized))
                .catch(console.error);
        }
    }, []);

    useEffect(() => {
        if (!user) return;
        const q = query(collection(db, "slideshows"), where("userId", "==", user.uid));
        return onSnapshot(q, (snap) => {
            setOwnedSlideshows(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow)));
        });
    }, [user]);

    const mediaWithTimestamps = useMemo(() => {
        if (!Array.isArray(mediaFiles)) return [];
        let currentPos = 0;
        return mediaFiles.map(m => {
            const start = currentPos;
            const dur = m.type === 'image' ? settings.interval : (m.duration || 5);
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

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const files = Array.from(e.target.files).slice(0, 20) as File[];
        
        const newMedia: MediaFile[] = await Promise.all(files.map(async f => {
            const previewUrl = URL.createObjectURL(f);
            let base64 = '';
            if (f.type.startsWith('image')) {
                const reader = new FileReader();
                base64 = await new Promise((resolve) => {
                    reader.onload = () => resolve((reader.result as string).split(',')[1]);
                    reader.readAsDataURL(f);
                });
            }
            return {
                id: Math.random().toString(36).substr(2, 9),
                type: f.type.startsWith('image') ? 'image' : 'video',
                previewUrl,
                caption: '',
                base64
            };
        }));
        setMediaFiles(p => [...p, ...newMedia]);
    };

    const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const file = e.target.files[0];
        const previewUrl = URL.createObjectURL(file);
        const newAudio: AppStateAudio = {
            id: Math.random().toString(36).substr(2, 9),
            name: file.name,
            duration: 180, 
            startTime: 0,
            previewUrl,
            source: 'local'
        };
        setAudioFiles(p => [...p, newAudio]);
    };

    const generateSmartCaptions = async () => {
        if (!Array.isArray(mediaFiles) || mediaFiles.length === 0) return;
        setIsProcessingCaptions(true);
        try {
            const updatedMedia = await Promise.all(mediaFiles.map(async (m) => {
                if (m.type === 'video' || !m.base64) return m;
                const response = await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: [
                        { text: "Generate a short, poetic, 1-sentence caption for this image that reflects a nostalgic memory." },
                        { inlineData: { mimeType: 'image/jpeg', data: m.base64 } }
                    ]
                });
                return { ...m, caption: response.text || '' };
            }));
            setMediaFiles(updatedMedia);
        } catch (e) {
            setError("Failed to generate smart captions.");
        } finally {
            setIsProcessingCaptions(false);
        }
    };

    const saveSlideshow = async () => {
        if (!user || !Array.isArray(mediaFiles) || mediaFiles.length === 0) return;
        const id = Math.random().toString(36).substr(2, 9);
        try {
            await setDoc(doc(db, "slideshows", id), {
                userId: user.uid,
                name: slideshowName || `Slideshow ${new Date().toLocaleDateString()}`,
                media: mediaFiles,
                audio: audioFiles,
                settings: settings,
                timestamp: serverTimestamp()
            });
            alert("Slideshow saved successfully!");
        } catch (e) {
            setError("Failed to save project.");
        }
    };

    const shareSlideshow = (id: string) => {
        const url = `${window.location.origin}?id=${id}`;
        navigator.clipboard.writeText(url);
        alert("Share link copied to clipboard!");
    };

    const deleteSlideshow = async (id: string) => {
        if (confirm("Are you sure you want to delete this slideshow?")) {
            await deleteDoc(doc(db, "slideshows", id));
        }
    };

    if (isLoading) return <div className="min-h-screen bg-brand-dark flex items-center justify-center"><div className="w-8 h-8 border-2 border-brand-purple border-t-transparent rounded-full animate-spin"></div></div>;

    return (
        <div className={`min-h-screen font-sans ${user ? 'bg-brand-dark text-gray-200' : 'bg-white text-gray-900'}`}>
            <header className="p-4 flex justify-between items-center border-b border-gray-800 bg-gray-900/50 sticky top-0 z-40 backdrop-blur-md">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-brand-purple rounded-lg flex items-center justify-center font-black text-white">M</div>
                    <h1 className="text-xl font-bold tracking-tight text-white"><span className="text-brand-purple">Muziq</span> Slides</h1>
                </div>
                <div>
                    {user ? (
                        <div className="flex items-center gap-4">
                            <span className="text-xs text-gray-400 hidden sm:inline">Welcome, {user.displayName}</span>
                            <button onClick={() => signOut(auth)} className="text-xs bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg font-bold border border-gray-700 transition-colors">Logout</button>
                        </div>
                    ) : (
                        <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="text-xs bg-brand-purple hover:bg-brand-purple/80 px-4 py-2 rounded-lg font-bold text-white transition-all shadow-lg shadow-brand-purple/20">Sign In</button>
                    )}
                </div>
            </header>

            {!user ? (
                <main>
                    <section className="text-center pt-24 pb-16 px-4 bg-gradient-to-b from-brand-light to-white">
                        <h2 className="text-6xl font-black mb-6 tracking-tighter text-brand-dark leading-none">Your Library,<br/>Your <span className="text-brand-purple underline decoration-apple-red decoration-4">Stories</span></h2>
                        <p className="text-gray-500 mb-10 max-w-lg mx-auto text-lg">Create stunning cinematic slideshows synchronized with Apple Music. Turn your memories into a living gallery.</p>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="bg-brand-purple text-white px-10 py-4 rounded-full font-bold shadow-xl hover:scale-105 transition-transform">Get Started Free</button>
                            <a href="#features" className="px-10 py-4 rounded-full font-bold text-brand-dark border-2 border-brand-dark/10 hover:bg-brand-dark/5 transition-colors">Learn More</a>
                        </div>
                    </section>

                    <section id="features" className="py-20 px-4 max-w-6xl mx-auto">
                        <h3 className="text-3xl font-black mb-12 text-center text-brand-dark">Key Features</h3>
                        <div className="grid md:grid-cols-3 gap-8">
                            {[
                                { title: "Apple Music Integration", desc: "Access millions of songs to set the perfect mood for your memories.", icon: "🎵" },
                                { title: "AI Smart Captions", desc: "Our AI analyzes your photos to generate poetic, nostalgic descriptions automatically.", icon: "✨" },
                                { title: "Cinematic Transitions", desc: "Professional Ken Burns effects, zooms, and fades for a high-end feel.", icon: "🎬" },
                                { title: "Cross-Platform Sharing", desc: "Share your creations with a single link. Works on TV, Mobile, and Desktop.", icon: "🔗" },
                                { title: "20+ Multi-Media", desc: "Mix up to 20 images and videos in a single seamless presentation.", icon: "📸" },
                                { title: "TV Screensaver Ready", desc: "Optimized for large screens to turn your TV into a dynamic digital frame.", icon: "📺" }
                            ].map((f, i) => (
                                <div key={i} className="p-8 rounded-3xl bg-gray-50 border border-gray-100 hover:shadow-lg transition-shadow">
                                    <div className="text-4xl mb-4">{f.icon}</div>
                                    <h4 className="text-xl font-bold mb-2 text-brand-dark">{f.title}</h4>
                                    <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
                                </div>
                            ))}
                        </div>
                    </section>
                </main>
            ) : (
                <main className="p-4 max-w-7xl mx-auto grid lg:grid-cols-12 gap-8 py-8">
                    {/* LEFT PANEL: CONFIGURATION */}
                    <div className="lg:col-span-4 space-y-6">
                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-sm font-bold uppercase mb-4 text-brand-purple tracking-widest flex items-center gap-2">
                                <span className="bg-brand-purple text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">1</span>
                                Media Library
                            </h3>
                            <div className="space-y-4">
                                <div className="border-2 border-dashed border-gray-700 rounded-2xl p-6 text-center hover:border-brand-purple transition-colors cursor-pointer relative">
                                    <input type="file" multiple accept="image/*,video/*" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                    <div className="text-2xl mb-2">📸</div>
                                    <p className="text-xs text-gray-400">Click to upload images or videos (Max 20)</p>
                                </div>
                                <div className="grid grid-cols-4 gap-2">
                                    {Array.isArray(mediaFiles) && mediaFiles.map((m, i) => (
                                        <div key={m.id} className="aspect-square bg-gray-900 rounded-lg overflow-hidden relative group">
                                            <img src={m.previewUrl} className="w-full h-full object-cover" alt="" />
                                            <button onClick={() => setMediaFiles(p => p.filter(x => x.id !== m.id))} className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                {Array.isArray(mediaFiles) && mediaFiles.length > 0 && (
                                    <button 
                                        onClick={generateSmartCaptions} 
                                        disabled={isProcessingCaptions}
                                        className="w-full bg-brand-purple/20 text-brand-purple py-3 rounded-xl text-xs font-bold border border-brand-purple/30 flex items-center justify-center gap-2 hover:bg-brand-purple/30 transition-colors"
                                    >
                                        {isProcessingCaptions ? <div className="w-3 h-3 border-2 border-brand-purple border-t-transparent rounded-full animate-spin"></div> : '✨'}
                                        {isProcessingCaptions ? 'Generating Captions...' : 'Generate Smart Captions'}
                                    </button>
                                )}
                            </div>
                        </section>

                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-sm font-bold uppercase mb-4 text-brand-purple tracking-widest flex items-center gap-2">
                                <span className="bg-brand-purple text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">2</span>
                                Soundtrack
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="relative">
                                    <button className="w-full bg-gray-700 py-3 rounded-xl text-[10px] font-bold text-white border border-gray-600">Choose File</button>
                                    <input type="file" accept="audio/*" onChange={handleAudioUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                </div>
                                <button onClick={() => setIsMusicBrowserOpen(true)} className="w-full bg-apple-red/10 py-3 rounded-xl text-[10px] font-bold text-apple-red border border-apple-red/30 flex items-center justify-center gap-2">
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
                                    Browse Apple
                                </button>
                            </div>
                            <div className="mt-4 space-y-2">
                                {Array.isArray(audioFiles) && audioFiles.map(a => (
                                    <div key={a.id} className="bg-gray-900/50 border border-gray-700 p-3 rounded-xl text-[10px] flex justify-between items-center">
                                        <div className="truncate pr-4">
                                            <span className="text-gray-400 block uppercase tracking-tighter text-[8px]">{a.source}</span>
                                            <span className="font-bold">{a.name}</span>
                                        </div>
                                        <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))} className="text-gray-500 hover:text-red-500 transition-colors">🗑️</button>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-sm font-bold uppercase mb-4 text-brand-purple tracking-widest flex items-center gap-2">
                                <span className="bg-brand-purple text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">3</span>
                                Transitions
                            </h3>
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    { id: 'ken-burns', name: 'Ken Burns' },
                                    { id: 'fade-in', name: 'Classic Fade' },
                                    { id: 'slide-from-right', name: 'Slide' },
                                    { id: 'zoom-in', name: 'Deep Zoom' }
                                ].map(style => (
                                    <button 
                                        key={style.id} 
                                        onClick={() => setSettings(s => ({ ...s, slideStyle: style.id }))}
                                        className={`py-3 px-4 rounded-xl text-[10px] font-bold border transition-all ${settings.slideStyle === style.id ? 'bg-brand-purple border-brand-purple text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}
                                    >
                                        {style.name}
                                    </button>
                                ))}
                            </div>
                            <div className="mt-6">
                                <label className="text-[10px] uppercase font-bold text-gray-500 block mb-2">Display Duration: {settings.interval}s</label>
                                <input type="range" min="3" max="15" value={settings.interval} onChange={(e) => setSettings(s => ({ ...s, interval: parseInt(e.target.value) }))} className="w-full accent-brand-purple" />
                            </div>
                        </section>
                    </div>

                    {/* RIGHT PANEL: PREVIEW & SAVED */}
                    <div className="lg:col-span-8 space-y-8">
                        <section className="bg-gray-800/30 p-8 rounded-[2.5rem] border border-gray-700/50">
                            <div className="flex justify-between items-center mb-6">
                                <input 
                                    value={slideshowName} 
                                    onChange={(e) => setSlideshowName(e.target.value)} 
                                    placeholder="Untitled Slideshow"
                                    className="bg-transparent text-2xl font-black text-white outline-none placeholder:text-gray-700 w-full"
                                />
                                <div className="flex gap-2">
                                    <button onClick={saveSlideshow} className="bg-gray-800 text-white px-6 py-2 rounded-full text-xs font-bold border border-gray-700 hover:bg-gray-700 transition-colors">Save Project</button>
                                    <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="bg-brand-purple text-white px-8 py-2 rounded-full text-xs font-bold shadow-xl shadow-brand-purple/20 hover:bg-brand-purple/80 transition-all">Preview Live</button>
                                </div>
                            </div>
                            
                            <div className="aspect-video bg-black rounded-3xl relative overflow-hidden flex items-center justify-center border border-gray-700/50 shadow-2xl">
                                {Array.isArray(mediaFiles) && mediaFiles.length > 0 ? (
                                    <img src={mediaFiles[0].previewUrl} className="w-full h-full object-cover opacity-30 grayscale" alt="" />
                                ) : (
                                    <div className="text-center">
                                        <div className="text-4xl mb-4 grayscale">🖼️</div>
                                        <p className="text-gray-600 text-xs uppercase font-black tracking-widest">Workspace Empty</p>
                                    </div>
                                )}
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="w-20 h-20 bg-brand-purple/90 rounded-full flex items-center justify-center shadow-2xl hover:scale-110 transition-transform active:scale-95">
                                        <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                    </button>
                                </div>
                            </div>
                        </section>

                        <section>
                            <h3 className="text-sm font-bold uppercase mb-6 text-gray-500 tracking-widest">Saved Collections</h3>
                            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
                                {Array.isArray(ownedSlideshows) && ownedSlideshows.map(ss => (
                                    <div key={ss.id} className="bg-gray-800/40 border border-gray-700/50 p-5 rounded-[2rem] group hover:border-brand-purple/50 transition-colors">
                                        <div className="aspect-video bg-gray-900 rounded-2xl mb-4 overflow-hidden relative">
                                            {Array.isArray(ss.media) && ss.media[0] && <img src={ss.media[0].previewUrl} className="w-full h-full object-cover opacity-60" alt="" />}
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                                                <button onClick={() => {
                                                    loadProject(ss);
                                                    setIsPlaying(true);
                                                }} className="bg-white text-brand-dark px-4 py-2 rounded-full font-bold text-xs shadow-xl active:scale-95 transition-all">Quick Play</button>
                                            </div>
                                        </div>
                                        <h4 className="font-bold truncate text-sm mb-1">{ss.name}</h4>
                                        <p className="text-[10px] text-gray-500 mb-4">{Array.isArray(ss.media) ? ss.media.length : 0} items • {ss.settings?.slideStyle || 'default'}</p>
                                        <div className="flex flex-wrap gap-2">
                                            <button onClick={() => loadProject(ss)} className="flex-1 bg-brand-purple text-white py-2 rounded-xl text-[10px] font-bold hover:bg-brand-purple/80 transition-colors">Load</button>
                                            <button onClick={() => shareSlideshow(ss.id)} className="flex-1 bg-gray-700 text-gray-200 py-2 rounded-xl text-[10px] font-bold hover:bg-gray-600 transition-colors">Share</button>
                                            <button onClick={() => deleteSlideshow(ss.id)} className="px-3 bg-red-500/10 text-red-500 py-2 rounded-xl text-[10px] font-bold hover:bg-red-500 hover:text-white transition-colors">🗑️</button>
                                        </div>
                                    </div>
                                ))}
                                {(!Array.isArray(ownedSlideshows) || ownedSlideshows.length === 0) && (
                                    <div className="col-span-full py-12 text-center bg-gray-800/20 border border-gray-700/30 rounded-[2rem]">
                                        <p className="text-xs text-gray-600 uppercase tracking-widest font-bold">No saved collections yet</p>
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>
                </main>
            )}

            {/* APPLE MUSIC BROWSER MODAL */}
            {isMusicBrowserOpen && (
                <div className="fixed inset-0 bg-black/95 z-[200] flex items-center justify-center p-4 backdrop-blur-md">
                    <div className="bg-gray-900 w-full max-w-2xl h-[80vh] rounded-[3rem] border border-gray-800 flex flex-col overflow-hidden shadow-2xl">
                        <header className="p-8 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
                            <div>
                                <h2 className="font-black text-white text-xl uppercase tracking-tighter">Apple Music</h2>
                                <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">Select from your library</p>
                            </div>
                            <button onClick={() => setIsMusicBrowserOpen(false)} className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center hover:bg-gray-700">✕</button>
                        </header>
                        
                        {!appleMusicAuthorized ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                                <div className="w-20 h-20 bg-apple-red rounded-3xl flex items-center justify-center mb-8 shadow-2xl shadow-apple-red/30">
                                    <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
                                </div>
                                <h3 className="text-xl font-bold mb-4">Connect to Music</h3>
                                <p className="text-xs text-gray-500 mb-10 max-w-xs leading-relaxed">Authorize Muziq Slides to access your library and playlists for the ultimate cinematic experience.</p>
                                <button 
                                    onClick={async () => {
                                        const music = (window as any).MusicKit.getInstance();
                                        await music.authorize();
                                        setAppleMusicAuthorized(true);
                                    }} 
                                    className="bg-apple-red text-white py-4 px-12 rounded-full font-bold uppercase text-xs shadow-xl shadow-apple-red/20 active:scale-95 transition-all"
                                >
                                    Authorize with Apple
                                </button>
                            </div>
                        ) : (
                            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                                <p className="text-[10px] text-gray-500 font-bold uppercase mb-4 tracking-widest">Your Playlists</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-gray-800/50 p-6 rounded-[2rem] border border-gray-700 text-center cursor-pointer hover:border-apple-red transition-colors" onClick={async () => {
                                        const music = (window as any).MusicKit.getInstance();
                                        try {
                                            const playlists = await music.api.library.playlists();
                                            if (playlists && playlists.length > 0) {
                                                const tracks = await music.api.library.playlist(playlists[0].id);
                                                if (tracks?.relationships?.tracks?.data?.length > 0) {
                                                    const t = tracks.relationships.tracks.data[0];
                                                    setAudioFiles(p => [...p, { id: t.id, name: t.attributes.name, duration: t.attributes.durationInMillis/1000, startTime: 0, previewUrl: '', source: 'apple-music', appleMusicTrackId: t.id }]);
                                                    setIsMusicBrowserOpen(false);
                                                }
                                            } else {
                                                alert("No playlists found in your library.");
                                            }
                                        } catch (e) {
                                            setError("Failed to fetch music library data.");
                                        }
                                    }}>
                                        <div className="text-2xl mb-2">🎶</div>
                                        <span className="text-[10px] font-black uppercase">Recent Playlists</span>
                                    </div>
                                </div>
                                <p className="text-[10px] text-gray-400 mt-8 italic">Browse full library functionality is powered by standard MusicKit JS methods.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* THEATER MODE (SLIDESHOW VIEW) */}
            {isPlaying && (
                <div className="fixed inset-0 bg-black z-[100] flex flex-col items-center justify-center cursor-none">
                    <button 
                        onClick={() => setIsPlaying(false)} 
                        className="absolute top-8 right-8 text-white/30 hover:text-white p-4 z-[110] transition-colors cursor-pointer"
                    >
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                    
                    <div className="w-full h-full relative flex items-center justify-center overflow-hidden">
                        {Array.isArray(mediaWithTimestamps) && mediaWithTimestamps.map((m, idx) => (
                            <TheaterMedia 
                                key={m.id} 
                                media={m} 
                                isVisible={idx === currentSlide} 
                                slideStyle={settings.slideStyle}
                                showCaptions={settings.showCaptions}
                            />
                        ))}
                    </div>

                    {/* AUDIO ENGINE */}
                    {Array.isArray(audioFiles) && audioFiles.map(a => {
                        const active = elapsedTime >= a.startTime && elapsedTime < (a.startTime + a.duration);
                        return a.source === 'apple-music' ? 
                            <AppleMusicPlayer key={a.id} trackId={a.appleMusicTrackId!} active={active} startTimeInFile={elapsedTime - a.startTime} /> :
                            <AudioPlayer key={a.id} src={a.previewUrl} active={active} startTimeInFile={elapsedTime - a.startTime} />
                    })}

                    {/* PLAYBACK PROGRESS */}
                    <div className="absolute bottom-0 left-0 h-1 bg-brand-purple z-[120] transition-all duration-300" style={{ width: `${(elapsedTime / totalSlideshowDuration) * 100}%` }}></div>
                </div>
            )}
            
            {error && (
                <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-red-600 text-white p-4 rounded-2xl shadow-2xl z-[500] flex justify-between items-center animate-fade-in">
                    <p className="text-xs font-bold">{error}</p>
                    <button onClick={() => setError(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">✕</button>
                </div>
            )}
        </div>
    );
};

export default App;
