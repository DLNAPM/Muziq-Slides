
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
    addDoc,
    updateDoc
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

// --- MOCK DATA FOR SIMULATION ---
const MOCK_TRACKS = [
    { id: 'sim-1', name: 'Golden Hour Memories', duration: 185, source: 'apple-music' as const },
    { id: 'sim-2', name: 'Midnight City Vibe', duration: 210, source: 'apple-music' as const },
    { id: 'sim-3', name: 'Nostalgic Summer', duration: 155, source: 'apple-music' as const },
    { id: 'sim-4', name: 'Cinematic Piano Dreams', duration: 300, source: 'apple-music' as const },
];

// --- IMAGE COMPRESSION UTILITY ---
// Reduced size and quality further to strictly avoid Firestore 1MB limits for 20 photos
const compressImage = (base64Str: string): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${base64Str}`;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800; 
            let width = img.width;
            let height = img.height;
            if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            // 0.4 quality is safe for 1MB Firestore limit with 20 photos (~40kb per image)
            resolve(canvas.toDataURL('image/jpeg', 0.4).split(',')[1]);
        };
        img.onerror = () => resolve(base64Str);
    });
};

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
    missing?: boolean;
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
    // Key ensures animation re-triggers on every transition
    const animationClass = isVisible ? `animate-${slideStyle}` : 'opacity-0 pointer-events-none';
    
    return (
        <div className={`w-full h-full absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-700 ${isVisible ? 'opacity-100 z-20' : 'opacity-0 z-10'}`}>
            <div key={`${media.id}-${isVisible}`} className={`w-full h-full flex items-center justify-center ${animationClass}`}>
                {media.type === 'image' ? (
                    <img src={media.previewUrl} className="w-full h-full object-contain" alt="slide" />
                ) : (
                    <video src={media.previewUrl} className="w-full h-full object-contain" autoPlay muted loop />
                )}
            </div>
            {showCaptions && media.caption && isVisible && (
                <div className="absolute bottom-12 left-0 right-0 text-center z-30">
                    <span className="bg-black/60 text-white px-6 py-2 rounded-full text-lg font-medium backdrop-blur-sm animate-fade-in max-w-[80%] inline-block">
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
        if (!music || !music.isAuthorized || trackId.startsWith('sim-')) return;
        if (active) {
            music.setQueue({ song: trackId }).then(() => {
                if (music.playbackState !== 2) music.play();
                if (Math.abs(music.currentPlaybackTime - startTimeInFile) > 1.0) music.seekToTime(startTimeInFile);
            }).catch(() => {});
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
        if (!audio || !src) return;
        if (active) {
            if (audio.paused) audio.play().catch(() => {});
            if (Math.abs(audio.currentTime - startTimeInFile) > 0.5) {
                audio.currentTime = Math.max(0, startTimeInFile);
            }
        } else {
            if (!audio.paused) audio.pause();
        }
    }, [active, startTimeInFile, src]);
    return <audio ref={audioRef} src={src} preload="auto" />;
};

const HelpModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/80 z-[600] flex items-center justify-center p-6 backdrop-blur-md animate-fade-in">
            <div className="bg-gray-900 border border-gray-800 max-w-2xl w-full rounded-[2.5rem] p-10 overflow-y-auto max-h-[85vh] shadow-2xl">
                <div className="flex justify-between items-start mb-8">
                    <div>
                        <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Build Guide & Disclaimers</h2>
                        <p className="text-xs text-brand-purple font-black uppercase tracking-widest mt-1">Mastering Muziq Slides</p>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 bg-gray-800 hover:bg-gray-700 text-white rounded-full flex items-center justify-center transition-all">✕</button>
                </div>
                
                <div className="space-y-8 text-gray-400 text-sm leading-relaxed">
                    <section>
                        <h4 className="text-white font-bold uppercase text-xs mb-3 tracking-widest">How to Use the Builder</h4>
                        <ol className="list-decimal list-inside space-y-2">
                            <li><b>Upload Content:</b> Add up to 20 photos or videos. Images are optimized automatically to stay synced with the cloud.</li>
                            <li><b>Soundtrack:</b> Connect Apple Music or use "Simulated Mode" to test tracks from our curated catalog.</li>
                            <li><b>Studio Mode:</b> Switch tabs to adjust audio start times and track layering.</li>
                            <li><b>AI Captions:</b> Use "Smart Captions" to let Gemini Pro write poetic descriptions for each slide.</li>
                            <li><b>Cloud Save:</b> Projects are tied to your login. Saved collections load automatically next time you sign in.</li>
                        </ol>
                    </section>

                    <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-3xl">
                        <h4 className="text-red-400 font-bold uppercase text-[10px] mb-2 tracking-widest flex items-center gap-2">
                            <span>⚠️</span> Prohibited Use & Disclaimers
                        </h4>
                        <ul className="list-disc list-inside space-y-1 text-red-400/80 text-[11px] font-medium">
                            <li><b>NOT for Data Storage:</b> This app compresses files for performance. Do not use it as your only copy of a memory.</li>
                            <li><b>NOT for Professional Broadcast:</b> Designed for personal creative storytelling only.</li>
                            <li><b>Copyright Respect:</b> Users are responsible for ensuring they have rights to all uploaded media.</li>
                            <li><b>Music Access:</b> Shared collections require recipients to have their own music access for real Apple Music tracks.</li>
                        </ul>
                    </div>
                </div>
                
                <button onClick={onClose} className="w-full mt-10 bg-brand-purple py-4 rounded-2xl font-black uppercase text-xs text-white shadow-xl shadow-brand-purple/20 hover:scale-[1.02] active:scale-95 transition-all">Continue Building</button>
            </div>
        </div>
    );
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
    const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
    const [ownedSlideshows, setOwnedSlideshows] = useState<SavedSlideshow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessingCaptions, setIsProcessingCaptions] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isMusicBrowserOpen, setIsMusicBrowserOpen] = useState(false);
    const [appleMusicAuthorized, setAppleMusicAuthorized] = useState(false);
    const [viewMode, setViewMode] = useState<'easy' | 'studio'>('easy');
    const [isSimulationMode, setIsSimulationMode] = useState(false);
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    
    const requestRef = useRef<number>(0);
    const startTimeRef = useRef<number>(0);
    const lastTickTimeRef = useRef<number>(0);

    const ai = useMemo(() => new GoogleGenAI({ apiKey: process.env.API_KEY }), []);

    // Restoration Helper: Converts base64 back to preview URLs for display
    const reconstructMedia = useCallback((media: MediaFile[]) => {
        return (media || []).map(m => {
            if (m.base64 && (!m.previewUrl || m.previewUrl.startsWith('blob:'))) {
                return { ...m, previewUrl: `data:image/jpeg;base64,${m.base64}` };
            }
            return m;
        });
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => { 
            setUser(u); 
            setIsLoading(false); 
        });
        const params = new URLSearchParams(window.location.search);
        const sharedId = params.get('id');
        if (sharedId) loadSharedSlideshow(sharedId);
        return unsubscribe;
    }, []);

    const loadSharedSlideshow = async (id: string) => {
        const docRef = doc(db, "slideshows", id);
        try {
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = { id: docSnap.id, ...docSnap.data() } as SavedSlideshow;
                loadProject(data);
                setIsPlaying(true);
            }
        } catch (e) {
            setError("Failed to load shared collection.");
        }
    };

    const loadProject = useCallback((project: SavedSlideshow) => {
        if (!project) return;
        const restoredMedia = reconstructMedia(project.media);
        const restoredAudio = (Array.isArray(project.audio) ? project.audio : []).map(a => {
            if (a.source === 'local' && !a.previewUrl) return { ...a, missing: true };
            return a;
        });
        setCurrentProjectId(project.id || null);
        setMediaFiles(restoredMedia);
        setAudioFiles(restoredAudio);
        setSettings(project.settings || { interval: 5, slideStyle: 'ken-burns', repeatSlideshow: false, showCaptions: true });
        setSlideshowName(project.name || '');
        setElapsedTime(0);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [reconstructMedia]);

    useEffect(() => {
        const teamId = (process.env as any).TEAM_ID;
        const keyId = (process.env as any).KEY_ID;
        const authToken = (process.env as any).AUTH_TOKEN;
        if (teamId && keyId && authToken) {
            generateAppleMusicJWT(keyId, teamId, authToken)
                .then(token => {
                    const mkInit = () => {
                        if (!(window as any).MusicKit) return false;
                        (window as any).MusicKit.configure({ developerToken: token, app: { name: 'Muziq Slides', build: '1.0.9' } });
                        return true;
                    };
                    if (!mkInit()) {
                        const itvl = setInterval(() => { if (mkInit()) { clearInterval(itvl); setAppleMusicAuthorized((window as any).MusicKit.getInstance().isAuthorized); } }, 500);
                    } else {
                        setAppleMusicAuthorized((window as any).MusicKit.getInstance().isAuthorized);
                    }
                })
                .catch(() => setIsSimulationMode(true));
        } else {
            setIsSimulationMode(true);
        }
    }, []);

    useEffect(() => {
        if (!user) { setOwnedSlideshows([]); return; }
        const q = query(collection(db, "slideshows"), where("userId", "==", user.uid));
        return onSnapshot(q, (snap) => {
            const projects = snap.docs.map(d => {
                const data = d.data() as SavedSlideshow;
                // Reconstruct thumbnails for the card list so they don't look broken
                const media = reconstructMedia(data.media);
                return { id: d.id, ...data, media } as SavedSlideshow;
            });
            setOwnedSlideshows(projects);
        });
    }, [user, reconstructMedia]);

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
        if (!startTimeRef.current) {
            startTimeRef.current = time;
            lastTickTimeRef.current = time;
        }
        const delta = (time - lastTickTimeRef.current) / 1000;
        lastTickTimeRef.current = time;
        if (delta > 1.0) { requestRef.current = requestAnimationFrame(animate); return; }
        setElapsedTime(prev => {
            let next = prev + delta;
            if (next >= totalSlideshowDuration) {
                if (settings.repeatSlideshow) return 0;
                setIsPlaying(false);
                return totalSlideshowDuration;
            }
            return next;
        });
        requestRef.current = requestAnimationFrame(animate);
    }, [totalSlideshowDuration, settings.repeatSlideshow]);

    useEffect(() => {
        if (isPlaying) {
            startTimeRef.current = 0;
            requestRef.current = requestAnimationFrame(animate);
        } else {
            cancelAnimationFrame(requestRef.current);
        }
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
                const rawBase64: string = await new Promise((resolve) => {
                    reader.onload = () => resolve((reader.result as string).split(',')[1]);
                    reader.readAsDataURL(f);
                });
                base64 = await compressImage(rawBase64);
            }
            return {
                id: Math.random().toString(36).substr(2, 9),
                type: f.type.startsWith('image') ? 'image' : 'video',
                previewUrl: f.type.startsWith('image') ? `data:image/jpeg;base64,${base64}` : previewUrl,
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
        const audio = new Audio(previewUrl);
        audio.onloadedmetadata = () => {
            setAudioFiles(p => [...p, { id: Math.random().toString(36).substr(2, 9), name: file.name, duration: audio.duration, startTime: 0, previewUrl, source: 'local' }]);
        };
    };

    const generateSmartCaptions = async () => {
        if (!Array.isArray(mediaFiles) || mediaFiles.length === 0) return;
        setIsProcessingCaptions(true);
        try {
            const updatedMedia = await Promise.all(mediaFiles.map(async (m) => {
                if (m.type === 'video' || !m.base64) return m;
                const response = await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: {
                      parts: [
                        { text: "Analyze this photo and write a cinematic, one-sentence nostalgic caption. Keep it evocative and short. Poem-like." },
                        { inlineData: { mimeType: 'image/jpeg', data: m.base64 } }
                      ]
                    }
                });
                return { ...m, caption: response.text || '' };
            }));
            setMediaFiles(updatedMedia);
        } catch (e) {
            console.error("Smart Captions Error:", e);
            setError("Smart Captions failed. Check API key and ensure images are valid.");
        } finally {
            setIsProcessingCaptions(false);
        }
    };

    const saveSlideshow = async () => {
        if (!user || !Array.isArray(mediaFiles) || mediaFiles.length === 0) { setError("Add content first."); return; }
        const totalSize = mediaFiles.reduce((acc, curr) => acc + (curr.base64?.length || 0), 0);
        if (totalSize > 950000) { 
            setError("Project too large for Cloud Storage (1MB limit). Removing a few photos usually fixes this."); 
            return; 
        }

        const projectData = {
            userId: user.uid,
            name: slideshowName || `Slideshow ${new Date().toLocaleDateString()}`,
            media: mediaFiles.map(({ previewUrl, ...rest }) => ({ ...rest, previewUrl: '' })), 
            audio: audioFiles.map(({ previewUrl, ...rest }) => ({ ...rest, previewUrl: '' })), 
            settings: settings,
            timestamp: serverTimestamp()
        };
        try {
            if (currentProjectId) { 
                await updateDoc(doc(db, "slideshows", currentProjectId), projectData); 
                alert("Collection updated successfully!"); 
            } else { 
                const docRef = await addDoc(collection(db, "slideshows"), projectData); 
                setCurrentProjectId(docRef.id); 
                alert("Collection saved to your cloud library!"); 
            }
        } catch (e: any) { 
            setError("Cloud Save Failed: " + (e.message || "Unknown Error")); 
        }
    };

    const shareSlideshow = (id: string) => { const url = `${window.location.origin}?id=${id}`; navigator.clipboard.writeText(url); alert("Share link copied!"); };

    const deleteSlideshow = async (id: string) => {
        if (confirm("Delete this collection forever?")) {
            await deleteDoc(doc(db, "slideshows", id));
            if (currentProjectId === id) { setCurrentProjectId(null); setMediaFiles([]); setAudioFiles([]); setSlideshowName(''); }
        }
    };

    const updateAudioStartTime = (id: string, newStartTime: number) => {
        setAudioFiles(prev => prev.map(a => a.id === id ? { ...a, startTime: Math.max(0, newStartTime) } : a));
    };

    const handleAuthorizeApple = async () => {
        try {
            const music = (window as any).MusicKit?.getInstance();
            if (!music) { setError("Apple Music kit still loading..."); return; }
            await music.authorize();
            setAppleMusicAuthorized(music.isAuthorized);
        } catch (err) { setError("Apple Music login failed."); setIsSimulationMode(true); }
    };

    const addMockTrack = (track: typeof MOCK_TRACKS[0]) => {
        setAudioFiles(p => [...p, { id: track.id + '-' + Math.random().toString(36).substr(2, 5), name: track.name + ' (Simulated)', duration: track.duration, startTime: 0, previewUrl: '', source: 'apple-music', appleMusicTrackId: track.id }]);
        setIsMusicBrowserOpen(false);
    };

    if (isLoading) return <div className="min-h-screen bg-brand-dark flex items-center justify-center"><div className="w-10 h-10 border-4 border-brand-purple border-t-transparent rounded-full animate-spin"></div></div>;

    return (
        <div className={`min-h-screen font-sans ${user ? 'bg-brand-dark text-gray-200' : 'bg-white text-gray-900'}`}>
            <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
            
            <header className="p-4 flex justify-between items-center border-b border-gray-800 bg-gray-900/80 sticky top-0 z-40 backdrop-blur-xl">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-brand-purple rounded-lg flex items-center justify-center font-black text-white shadow-lg shadow-brand-purple/20">M</div>
                    <h1 className="text-xl font-bold tracking-tight text-white"><span className="text-brand-purple">Muziq</span> Slides</h1>
                </div>
                <div className="flex items-center gap-4">
                    {user && (
                        <nav className="hidden sm:flex bg-gray-800/50 p-1 rounded-xl border border-gray-700">
                            <button onClick={() => setViewMode('easy')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'easy' ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/20' : 'text-gray-400 hover:text-white'}`}>Builder</button>
                            <button onClick={() => setViewMode('studio')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'studio' ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/20' : 'text-gray-400 hover:text-white'}`}>Studio</button>
                        </nav>
                    )}
                    {user ? (
                        <div className="flex items-center gap-2">
                            <button onClick={() => setIsHelpOpen(true)} className="w-8 h-8 bg-gray-800 text-brand-purple border border-gray-700 rounded-full flex items-center justify-center font-black hover:bg-gray-700 transition-all">?</button>
                            <button onClick={() => signOut(auth)} className="text-xs bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg font-bold border border-gray-700 transition-colors">Logout</button>
                        </div>
                    ) : (
                        <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="text-xs bg-brand-purple hover:bg-brand-purple/80 px-4 py-2 rounded-lg font-bold text-white transition-all shadow-lg shadow-brand-purple/20">Sign In</button>
                    )}
                </div>
            </header>

            {!user ? (
                <main>
                    <section className="text-center pt-32 pb-24 px-4 bg-gradient-to-b from-brand-light to-white">
                        <h2 className="text-7xl font-black mb-8 tracking-tighter text-brand-dark leading-none">Your History,<br/>In <span className="text-brand-purple underline decoration-apple-red decoration-8 underline-offset-8">Rhythm</span></h2>
                        <p className="text-gray-500 mb-12 max-w-xl mx-auto text-xl leading-relaxed">The only cinematic slideshow builder perfectly synced with Apple Music.</p>
                        <div className="flex flex-col sm:flex-row gap-6 justify-center">
                            <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="bg-brand-purple text-white px-12 py-5 rounded-full font-bold shadow-2xl hover:scale-105 transition-transform text-lg">Sign In to Start</button>
                            <a href="#guide" className="px-12 py-5 rounded-full font-bold text-brand-dark border-2 border-brand-dark/10 hover:bg-brand-dark/5 transition-colors text-lg">See the Guide</a>
                        </div>
                    </section>

                    <section id="guide" className="py-24 px-4 bg-white border-y border-gray-100">
                        <div className="max-w-4xl mx-auto">
                            <h3 className="text-4xl font-black mb-12 text-brand-dark uppercase tracking-tighter text-center">User Guide & Feature Set</h3>
                            <div className="grid md:grid-cols-2 gap-12 mb-16">
                                <div className="space-y-6">
                                    <div className="flex gap-4">
                                        <div className="w-10 h-10 bg-brand-purple rounded-2xl flex items-center justify-center text-white font-black flex-shrink-0 shadow-lg shadow-brand-purple/20">1</div>
                                        <div>
                                            <h4 className="font-black text-brand-dark uppercase text-sm tracking-wider mb-2">Build Your Show</h4>
                                            <p className="text-gray-500 text-sm leading-relaxed">Upload up to 20 media files. Our system handles image optimization so your shows load fast globally.</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-4">
                                        <div className="w-10 h-10 bg-brand-purple rounded-2xl flex items-center justify-center text-white font-black flex-shrink-0 shadow-lg shadow-brand-purple/20">2</div>
                                        <div>
                                            <h4 className="font-black text-brand-dark uppercase text-sm tracking-wider mb-2">Sync Audio Tracks</h4>
                                            <p className="text-gray-500 text-sm leading-relaxed">Use the Studio Timeline to offset audio start times. Connect Apple Music or use curated simulated tracks.</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-4">
                                        <div className="w-10 h-10 bg-brand-purple rounded-2xl flex items-center justify-center text-white font-black flex-shrink-0 shadow-lg shadow-brand-purple/20">3</div>
                                        <div>
                                            <h4 className="font-black text-brand-dark uppercase text-sm tracking-wider mb-2">AI Smart Captions</h4>
                                            <p className="text-gray-500 text-sm leading-relaxed">Gemini AI interprets your visuals and crafts nostalgic subtitles that match the cinematic vibe.</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-gray-50 p-8 rounded-[3rem] border border-gray-100 shadow-inner">
                                    <h4 className="font-black text-brand-dark uppercase text-sm tracking-wider mb-4 text-center">Important Disclaimers</h4>
                                    <div className="space-y-4 text-xs text-gray-500 font-medium leading-relaxed">
                                        <p><b>Muziq Slides</b> is a creative tool for personal storytelling. Please note:</p>
                                        <ul className="list-disc list-inside space-y-2">
                                            <li><b>Media Compression:</b> Images are heavily compressed for cloud sync. Keep original files locally.</li>
                                            <li><b>Professional Use:</b> Not intended for broadcast-grade 4K post-production work.</li>
                                            <li><b>Critical Signals:</b> Not for real-time safety, medical, or emergency information.</li>
                                            <li><b>Music Sharing:</b> Apple Music integration respects personal subscription limits on recipients' devices.</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section id="features" className="py-24 px-4 max-w-6xl mx-auto bg-white">
                        <h3 className="text-3xl font-black mb-16 text-center text-brand-dark uppercase tracking-tighter">Engineered Features</h3>
                        <div className="grid md:grid-cols-3 gap-8">
                            {[
                                { title: "Studio Timeline", desc: "Multi-track audio support with millisecond precise start-time offsets.", icon: "🎹" },
                                { title: "Music Library", desc: "Native Apple Music connection or high-vibe curated simulation tracks.", icon: "🎵" },
                                { title: "AI Storytelling", desc: "Automated image analysis and nostalgic captioning powered by Gemini.", icon: "✨" },
                                { title: "Cinematic Styles", desc: "Professional Ken Burns, Zoom, and Fade transitions built natively.", icon: "🎬" },
                                { title: "Cloud Collections", desc: "Persistence across devices with automatic Firestore synchronization.", icon: "☁️" },
                                { title: "Instant Sharing", desc: "High-performance links to share your curated collections instantly.", icon: "🔗" }
                            ].map((f, i) => (
                                <div key={i} className="p-10 rounded-[3rem] bg-gray-50 border border-gray-100 hover:shadow-2xl transition-all hover:-translate-y-2 group">
                                    <div className="text-5xl mb-6 group-hover:scale-110 transition-transform inline-block">{f.icon}</div>
                                    <h4 className="text-xl font-black mb-3 text-brand-dark uppercase tracking-tight">{f.title}</h4>
                                    <p className="text-gray-500 text-sm font-medium leading-relaxed">{f.desc}</p>
                                </div>
                            ))}
                        </div>
                    </section>
                </main>
            ) : (
                <main className="p-4 max-w-7xl mx-auto grid lg:grid-cols-12 gap-8 py-8">
                    {viewMode === 'studio' ? (
                        <div className="lg:col-span-12 space-y-8 animate-fade-in">
                            <section className="bg-gray-800/30 p-8 rounded-[3rem] border border-gray-700/50">
                                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                                    <div>
                                        <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Studio Timeline</h2>
                                        <p className="text-xs text-gray-500 uppercase font-bold tracking-widest mt-1">Multi-track precision</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={saveSlideshow} className="bg-brand-purple text-white px-8 py-3 rounded-full text-xs font-bold shadow-xl shadow-brand-purple/20 hover:scale-105 transition-all">Save Project</button>
                                        <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="bg-white text-brand-dark px-8 py-3 rounded-full text-xs font-bold hover:scale-105 transition-all">Watch Full Show</button>
                                    </div>
                                </div>

                                <div className="overflow-x-auto bg-gray-900/50 rounded-3xl p-6 border border-gray-700/50 relative">
                                    <div className="min-w-[1200px] space-y-6">
                                        <div className="flex border-b border-gray-800 pb-2 relative h-6">
                                            {Array.from({ length: Math.ceil(Math.max(totalSlideshowDuration, 60) / 10) + 1 }).map((_, i) => (
                                                <div key={i} className="absolute text-[9px] font-mono text-gray-600 border-l border-gray-800 h-2 pl-1" style={{ left: `${(i * 10) * 10}px` }}>
                                                    {i * 10}s
                                                </div>
                                            ))}
                                        </div>

                                        <div className="flex gap-1 relative h-16 items-center">
                                            <div className="absolute left-0 top-0 bottom-0 w-24 flex items-center -ml-28">
                                                <span className="text-[10px] uppercase font-black text-gray-600 tracking-widest">Visuals</span>
                                            </div>
                                            {mediaWithTimestamps.map(m => (
                                                <div key={m.id} className="h-12 bg-gray-800 rounded-lg overflow-hidden border border-gray-700 flex-shrink-0 relative group" style={{ width: `${(m.timelineEnd! - m.timelineStart!) * 10}px` }}>
                                                    <img src={m.previewUrl} className="w-full h-full object-cover opacity-50 group-hover:opacity-100 transition-opacity" alt="" />
                                                </div>
                                            ))}
                                        </div>

                                        <div className="space-y-4 relative">
                                            <div className="absolute left-0 top-0 bottom-0 w-24 flex items-start pt-4 -ml-28">
                                                <span className="text-[10px] uppercase font-black text-gray-600 tracking-widest">Audio Track</span>
                                            </div>
                                            {audioFiles.map((a, i) => (
                                                <div key={a.id} className="h-14 bg-apple-red/10 border border-apple-red/20 rounded-2xl relative group flex items-center px-4" style={{ width: `${a.duration * 10}px`, marginLeft: `${a.startTime * 10}px` }}>
                                                    <div className="flex flex-col gap-0.5 truncate">
                                                        <span className="text-[10px] font-black uppercase text-apple-red truncate">{a.name}</span>
                                                        <span className="text-[9px] text-apple-red/60 font-mono">Offset: {a.startTime}s</span>
                                                    </div>
                                                    <div className="absolute top-0 right-0 h-full flex items-center px-4 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-l from-gray-900 to-transparent rounded-r-2xl">
                                                        <label className="text-[9px] text-gray-400 mr-2 uppercase font-bold">Start (s):</label>
                                                        <input 
                                                            type="number" 
                                                            value={a.startTime} 
                                                            onChange={(e) => updateAudioStartTime(a.id, parseInt(e.target.value) || 0)}
                                                            className="w-16 bg-gray-800 text-[11px] border border-gray-700 rounded-lg px-2 py-1 outline-none text-white font-bold"
                                                        />
                                                        <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))} className="ml-4 text-apple-red hover:text-white transition-colors bg-red-500/10 p-1.5 rounded-lg">🗑️</button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </div>
                    ) : (
                        <>
                            <div className="lg:col-span-4 space-y-6 animate-fade-in">
                                <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                                    <h3 className="text-sm font-black uppercase mb-4 text-brand-purple tracking-widest flex items-center gap-2">
                                        <span className="bg-brand-purple text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">1</span>
                                        Collection
                                    </h3>
                                    <div className="space-y-4">
                                        <div className="border-2 border-dashed border-gray-700 rounded-3xl p-10 text-center hover:border-brand-purple transition-all cursor-pointer relative bg-gray-900/40 group">
                                            <input type="file" multiple accept="image/*,video/*" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                            <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">📸</div>
                                            <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest">Add up to 20 Photos</p>
                                        </div>
                                        <div className="grid grid-cols-4 gap-2">
                                            {mediaFiles.map((m) => (
                                                <div key={m.id} className="aspect-square bg-gray-900 rounded-xl overflow-hidden relative group border border-gray-800">
                                                    <img src={m.previewUrl} className="w-full h-full object-cover" alt="" />
                                                    <button onClick={() => setMediaFiles(p => p.filter(x => x.id !== m.id))} className="absolute top-1 right-1 bg-red-500/80 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                                                </div>
                                            ))}
                                        </div>
                                        {mediaFiles.length > 0 && (
                                            <button 
                                                onClick={generateSmartCaptions} 
                                                disabled={isProcessingCaptions}
                                                className="w-full bg-brand-purple/10 text-brand-purple py-4 rounded-2xl text-xs font-black uppercase border border-brand-purple/30 flex items-center justify-center gap-2 hover:bg-brand-purple hover:text-white transition-all shadow-lg shadow-brand-purple/5"
                                            >
                                                {isProcessingCaptions ? <div className="w-3 h-3 border-2 border-brand-purple border-t-transparent rounded-full animate-spin"></div> : '✨'}
                                                {isProcessingCaptions ? 'Polishing Stories...' : 'AI Smart Captions'}
                                            </button>
                                        )}
                                    </div>
                                </section>

                                <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                                    <h3 className="text-sm font-black uppercase mb-4 text-brand-purple tracking-widest flex items-center gap-2">
                                        <span className="bg-brand-purple text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">2</span>
                                        Soundtrack
                                    </h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="relative">
                                            <button className="w-full bg-gray-800 border border-gray-700 py-4 rounded-2xl text-[10px] font-black uppercase text-gray-400 hover:text-white transition-colors">Local MP3</button>
                                            <input type="file" accept="audio/*" onChange={handleAudioUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                        </div>
                                        <button onClick={() => setIsMusicBrowserOpen(true)} className="w-full bg-apple-red/10 py-4 rounded-2xl text-[10px] font-black uppercase text-apple-red border border-apple-red/30 flex items-center justify-center gap-2 hover:bg-apple-red hover:text-white transition-all">
                                            Browse Library
                                        </button>
                                    </div>
                                    <div className="mt-4 space-y-2">
                                        {audioFiles.map(a => (
                                            <div key={a.id} className={`bg-gray-900/50 border p-3 rounded-2xl text-[10px] flex justify-between items-center ${a.missing ? 'border-red-500/50' : 'border-gray-700'}`}>
                                                <div className="truncate pr-4 flex flex-col gap-0.5">
                                                    <span className="text-gray-500 block uppercase tracking-tighter text-[8px] font-black">{a.source}</span>
                                                    <span className={`font-bold ${a.missing ? 'text-red-400' : ''}`}>{a.missing ? '⚠️ Re-upload Required' : a.name}</span>
                                                </div>
                                                <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))} className="text-gray-600 hover:text-red-500 transition-colors">🗑️</button>
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                                    <h3 className="text-sm font-black uppercase mb-4 text-brand-purple tracking-widest flex items-center gap-2">
                                        <span className="bg-brand-purple text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">3</span>
                                        Transitions
                                    </h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        {['ken-burns', 'fade-in', 'slide-from-right', 'zoom-in'].map(styleId => (
                                            <button 
                                                key={styleId} 
                                                onClick={() => setSettings(s => ({ ...s, slideStyle: styleId }))}
                                                className={`py-3 px-4 rounded-xl text-[10px] font-bold border transition-all uppercase tracking-widest ${settings.slideStyle === styleId ? 'bg-brand-purple border-brand-purple text-white shadow-lg shadow-brand-purple/20' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}
                                            >
                                                {styleId.replace(/-/g, ' ')}
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            </div>

                            <div className="lg:col-span-8 space-y-8 animate-fade-in">
                                <section className="bg-gray-800/30 p-8 rounded-[3rem] border border-gray-700/50 relative overflow-hidden">
                                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 relative z-10">
                                        <input 
                                            value={slideshowName} 
                                            onChange={(e) => setSlideshowName(e.target.value)} 
                                            placeholder="Collection Name..."
                                            className="bg-transparent text-3xl font-black text-white outline-none placeholder:text-gray-800 w-full"
                                        />
                                        <div className="flex gap-2">
                                            <button onClick={saveSlideshow} className="bg-gray-800 text-white px-8 py-3 rounded-full text-xs font-bold border border-gray-700 hover:bg-gray-700 transition-colors">
                                                {currentProjectId ? 'Update' : 'Save'}
                                            </button>
                                            <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="bg-brand-purple text-white px-10 py-3 rounded-full text-xs font-bold shadow-2xl shadow-brand-purple/30 hover:bg-brand-purple/80 transition-all">Preview</button>
                                        </div>
                                    </div>
                                    
                                    <div className="aspect-video bg-gray-950 rounded-[2.5rem] relative overflow-hidden flex items-center justify-center border border-gray-800 shadow-2xl group">
                                        {mediaFiles.length > 0 ? (
                                            <img src={mediaFiles[0].previewUrl} className="w-full h-full object-cover opacity-20 blur-sm" alt="" />
                                        ) : (
                                            <p className="text-gray-700 text-xs uppercase font-black tracking-widest">Workspace Empty</p>
                                        )}
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="w-24 h-24 bg-brand-purple rounded-full flex items-center justify-center shadow-2xl hover:scale-110 transition-transform active:scale-95 group-hover:bg-brand-purple/80">
                                                <svg className="w-10 h-10 text-white ml-2" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                            </button>
                                        </div>
                                    </div>
                                </section>

                                <section>
                                    <h3 className="text-xs font-black uppercase mb-8 text-gray-600 tracking-widest">Your Cloud Collections</h3>
                                    <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
                                        {ownedSlideshows.map(ss => (
                                            <div key={ss.id} className="bg-gray-800/20 border border-gray-800 p-6 rounded-[2.5rem] group hover:border-brand-purple/40 transition-all">
                                                <div className="aspect-square bg-gray-900 rounded-3xl mb-5 overflow-hidden relative border border-gray-800">
                                                    {ss.media[0] && <img src={ss.media[0].previewUrl} className="w-full h-full object-cover opacity-40 group-hover:scale-105 transition-transform" alt="" />}
                                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                                                        <button onClick={() => { loadProject(ss); setIsPlaying(true); }} className="bg-white text-brand-dark px-6 py-2.5 rounded-full font-bold text-xs shadow-2xl active:scale-95 transition-all">Watch Preview</button>
                                                    </div>
                                                </div>
                                                <h4 className="font-bold truncate text-sm mb-1">{ss.name}</h4>
                                                <p className="text-[10px] text-gray-500 mb-5 font-bold uppercase tracking-widest">{ss.media.length} Photos/Videos</p>
                                                <div className="flex flex-wrap gap-2">
                                                    <button onClick={() => loadProject(ss)} className="flex-1 bg-brand-purple text-white py-2.5 rounded-2xl text-[10px] font-black uppercase hover:bg-brand-purple/80 transition-all">Load</button>
                                                    <button onClick={() => shareSlideshow(ss.id)} className="flex-1 bg-gray-800 text-gray-400 py-2.5 rounded-2xl text-[10px] font-black uppercase hover:bg-brand-purple/70 transition-all">Share</button>
                                                    <button onClick={() => deleteSlideshow(ss.id)} className="px-4 bg-red-500/10 text-red-500 py-2.5 rounded-2xl text-[10px] font-black hover:bg-red-500 hover:text-white transition-all">🗑️</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            </div>
                        </>
                    )}
                </main>
            )}

            {isMusicBrowserOpen && (
                <div className="fixed inset-0 bg-black/95 z-[200] flex items-center justify-center p-6 backdrop-blur-2xl">
                    <div className="bg-gray-950 w-full max-w-2xl h-[85vh] rounded-[3.5rem] border border-gray-800 flex flex-col overflow-hidden shadow-2xl">
                        <header className="p-10 border-b border-gray-900 flex justify-between items-center">
                            <div>
                                <h2 className="font-black text-white text-2xl uppercase tracking-tighter">Soundtrack Library</h2>
                                {isSimulationMode && <span className="text-[8px] bg-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded-full uppercase tracking-widest">Vibe Simulation Active</span>}
                            </div>
                            <button onClick={() => setIsMusicBrowserOpen(false)} className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center hover:bg-gray-800 text-gray-400 transition-all">✕</button>
                        </header>
                        
                        {!appleMusicAuthorized && !isSimulationMode ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                                <div className="w-24 h-24 bg-apple-red rounded-[2rem] flex items-center justify-center mb-10 shadow-2xl shadow-apple-red/40 animate-pulse">
                                    <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
                                </div>
                                <h3 className="text-2xl font-black mb-4 uppercase tracking-tighter">Authorize Apple Music</h3>
                                <div className="flex flex-col gap-4">
                                    <button onClick={handleAuthorizeApple} className="bg-apple-red text-white py-5 px-16 rounded-full font-black uppercase text-xs shadow-2xl shadow-apple-red/30 active:scale-95 hover:scale-105 transition-all">Sign In to MusicKit</button>
                                    <button onClick={() => setIsSimulationMode(true)} className="text-gray-500 hover:text-white transition-colors text-xs uppercase font-black tracking-widest">Or Browse Simulated Catalog</button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 overflow-y-auto p-8 space-y-4">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-4">{isSimulationMode ? 'Simulated Playlist' : 'Your Personal Library'}</h4>
                                {isSimulationMode ? (
                                    <div className="grid gap-3">
                                        {MOCK_TRACKS.map(track => (
                                            <div key={track.id} className="bg-gray-900/60 p-5 rounded-3xl border border-gray-800 flex justify-between items-center group hover:border-brand-purple transition-all cursor-pointer" onClick={() => addMockTrack(track)}>
                                                <div className="flex items-center gap-4">
                                                    <div className="w-10 h-10 bg-gray-800 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform">🎵</div>
                                                    <div>
                                                        <p className="font-bold text-sm text-white">{track.name}</p>
                                                        <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">Vibe Track • {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}</p>
                                                    </div>
                                                </div>
                                                <button className="bg-brand-purple/10 text-brand-purple text-[10px] font-black uppercase px-4 py-2 rounded-xl group-hover:bg-brand-purple group-hover:text-white transition-all">Add Track</button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="bg-gray-900/60 p-10 rounded-[2.5rem] border border-gray-800 text-center cursor-pointer hover:border-apple-red transition-all group" onClick={async () => {
                                        const music = (window as any).MusicKit?.getInstance();
                                        try {
                                            const playlists = await music.api.library.playlists();
                                            if (playlists?.length > 0) {
                                                const tracks = await music.api.library.playlist(playlists[0].id);
                                                const trackData = tracks?.relationships?.tracks?.data;
                                                if (trackData?.length > 0) {
                                                    const t = trackData[0];
                                                    setAudioFiles(p => [...p, { id: t.id, name: t.attributes.name, duration: (t.attributes.durationInMillis || 180000)/1000, startTime: 0, previewUrl: '', source: 'apple-music', appleMusicTrackId: t.id }]);
                                                    setIsMusicBrowserOpen(false);
                                                }
                                            } else { setError("Empty library found."); setIsSimulationMode(true); }
                                        } catch (e) { setError("Library Access Error."); setIsSimulationMode(true); }
                                    }}>
                                        <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">🎧</div>
                                        <span className="text-xs font-black uppercase tracking-widest text-gray-500 group-hover:text-apple-red">Load Playlist 01</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {isPlaying && (
                <div className="fixed inset-0 bg-black z-[500] flex flex-col items-center justify-center cursor-none">
                    <button onClick={() => setIsPlaying(false)} className="absolute top-10 right-10 text-white/40 hover:text-white p-5 z-[510] transition-colors cursor-pointer text-2xl">✕</button>
                    <div className="w-full h-full relative flex items-center justify-center overflow-hidden">
                        {mediaWithTimestamps.map((m, idx) => (
                            <TheaterMedia key={m.id} media={m} isVisible={idx === currentSlide} slideStyle={settings.slideStyle} showCaptions={settings.showCaptions} />
                        ))}
                    </div>
                    {audioFiles.map(a => {
                        const active = elapsedTime >= a.startTime && elapsedTime < (a.startTime + a.duration);
                        return a.source === 'apple-music' ? 
                            <AppleMusicPlayer key={a.id} trackId={a.appleMusicTrackId!} active={active} startTimeInFile={elapsedTime - a.startTime} /> :
                            <AudioPlayer key={a.id} src={a.previewUrl} active={active} startTimeInFile={elapsedTime - a.startTime} />
                    })}
                    <div className="absolute bottom-0 left-0 h-1.5 bg-brand-purple z-[520] transition-all duration-300 shadow-2xl shadow-brand-purple" style={{ width: `${(elapsedTime / totalSlideshowDuration) * 100}%` }}></div>
                </div>
            )}
            
            {error && (
                <div className="fixed bottom-6 left-6 right-6 md:left-auto md:right-6 md:w-[400px] bg-red-500 text-white p-6 rounded-[2rem] shadow-2xl z-[600] flex justify-between items-center animate-fade-in border border-white/20">
                    <div className="flex items-center gap-3">
                        <span className="text-xl">⚠️</span>
                        <p className="text-xs font-black uppercase tracking-tight leading-tight pr-4">{error}</p>
                    </div>
                    <button onClick={() => setError(null)} className="p-3 hover:bg-white/20 rounded-full transition-all text-sm font-bold">✕</button>
                </div>
            )}
        </div>
    );
};

export default App;
