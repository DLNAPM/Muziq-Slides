
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
    serverTimestamp,
    query,
    where,
    onSnapshot,
    deleteDoc,
    addDoc,
    updateDoc,
    arrayUnion
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
        exp: Math.floor(Date.now() / 1000) + (3600 * 24), 
    };
    
    const base64Url = (obj: object) => 
        window.btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    
    const tokenParts = `${base64Url(header)}.${base64Url(payload)}`;
    
    try {
        const pemContents = privateKeyPEM
            .replace(/-----BEGIN PRIVATE KEY-----/g, "")
            .replace(/-----END PRIVATE KEY-----/g, "")
            .replace(/\s/g, "");
            
        const binaryDer = Uint8Array.from(window.atob(pemContents), c => c.charCodeAt(0));
        const key = await window.crypto.subtle.importKey(
            "pkcs8", 
            binaryDer, 
            { name: "ECDSA", namedCurve: "P-256" }, 
            false, 
            ["sign"]
        );
        
        const signature = await window.crypto.subtle.sign(
            { name: "ECDSA", hash: { name: "SHA-256" } }, 
            key, 
            new TextEncoder().encode(tokenParts)
        );
        
        const base64UrlSignature = window.btoa(String.fromCharCode(...new Uint8Array(signature)))
            .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            
        return `${tokenParts}.${base64UrlSignature}`;
    } catch (e) {
        console.error("JWT Generation Error", e);
        throw new Error("Could not sign Apple Music Token.");
    }
}

// --- IMAGE COMPRESSION ---
const compressImage = (base64Str: string): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${base64Str}`;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 500; 
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
            resolve(canvas.toDataURL('image/jpeg', 0.3).split(',')[1]);
        };
        img.onerror = () => resolve(base64Str);
    });
};

// --- TYPES ---
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
    sharedWith?: string[];
}

// --- MOCK DATA ---
const MOCK_TRACKS: AppStateAudio[] = [
    { id: 'm1', name: 'Golden Hour Memories', duration: 184, startTime: 0, previewUrl: '', source: 'apple-music' },
    { id: 'm2', name: 'Midnight City Lights', duration: 215, startTime: 0, previewUrl: '', source: 'apple-music' },
    { id: 'm3', name: 'Ocean Breeze Whispers', duration: 142, startTime: 0, previewUrl: '', source: 'apple-music' },
    { id: 'm4', name: 'Mountain Peak Sunrise', duration: 198, startTime: 0, previewUrl: '', source: 'apple-music' },
];

const TheaterMedia: React.FC<{
    media: MediaFile;
    isVisible: boolean;
    slideStyle: string;
    showCaptions: boolean;
}> = ({ media, isVisible, slideStyle, showCaptions }) => {
    const animationClass = isVisible ? `animate-${slideStyle}` : 'opacity-0 pointer-events-none';
    const mediaUrl = (media.base64 && (!media.previewUrl || media.previewUrl === '')) 
        ? `data:image/jpeg;base64,${media.base64}` 
        : media.previewUrl;

    return (
        <div className={`w-full h-full absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-700 ${isVisible ? 'opacity-100 z-20' : 'opacity-0 z-10'}`}>
            <div key={`${media.id}-${isVisible}`} className={`w-full h-full flex items-center justify-center ${animationClass}`}>
                {media.type === 'image' ? (
                    <img src={mediaUrl} className="w-full h-full object-contain" alt="slide" />
                ) : (
                    <video src={mediaUrl} className="w-full h-full object-contain" autoPlay muted loop />
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
    const [sharedSlideshows, setSharedSlideshows] = useState<SavedSlideshow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessingCaptions, setIsProcessingCaptions] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isMusicBrowserOpen, setIsMusicBrowserOpen] = useState(false);
    const [appleMusicAuthorized, setAppleMusicAuthorized] = useState(false);
    const [viewMode, setViewMode] = useState<'easy' | 'studio'>('easy');
    const [isSimulationMode, setIsSimulationMode] = useState(false);
    
    const requestRef = useRef<number>(0);
    const startTimeRef = useRef<number>(0);
    const lastTickTimeRef = useRef<number>(0);

    const reconstructMedia = useCallback((media: MediaFile[]) => {
        return (media || []).map(m => {
            if (m.base64 && (!m.previewUrl || m.previewUrl === '' || m.previewUrl.startsWith('blob:'))) {
                return { ...m, previewUrl: `data:image/jpeg;base64,${m.base64}` };
            }
            return m;
        });
    }, []);

    const loadProject = useCallback((project: SavedSlideshow) => {
        if (!project) return;
        const restoredMedia = reconstructMedia(project.media);
        setCurrentProjectId(project.id || null);
        setMediaFiles(restoredMedia);
        setAudioFiles(project.audio || []);
        setSettings(project.settings || { interval: 5, slideStyle: 'ken-burns', repeatSlideshow: false, showCaptions: true });
        setSlideshowName(project.name || '');
        setElapsedTime(0);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [reconstructMedia]);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => { 
            setUser(u); 
            setIsLoading(false); 
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        if (!user) { setOwnedSlideshows([]); setSharedSlideshows([]); return; }
        
        // Owned projects
        const qOwned = query(collection(db, "slideshows"), where("userId", "==", user.uid));
        const unsubOwned = onSnapshot(qOwned, (snap) => {
            const projects = snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow));
            setOwnedSlideshows(projects.map(p => ({...p, media: reconstructMedia(p.media)})));
        });

        // Shared projects
        const qShared = query(collection(db, "slideshows"), where("sharedWith", "array-contains", user.email?.toLowerCase()));
        const unsubShared = onSnapshot(qShared, (snap) => {
            const projects = snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow));
            setSharedSlideshows(projects.map(p => ({...p, media: reconstructMedia(p.media)})));
        });

        return () => { unsubOwned(); unsubShared(); };
    }, [user, reconstructMedia]);

    const mediaWithTimestamps = useMemo(() => {
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
        if (!startTimeRef.current) startTimeRef.current = time;
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
            lastTickTimeRef.current = performance.now();
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
        const files: File[] = Array.from(e.target.files).slice(0, 20) as File[];
        const newMedia: MediaFile[] = await Promise.all(files.map(async (f: File) => {
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
                base64: base64 || ''
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
            setAudioFiles(p => [...p, { 
                id: Math.random().toString(36).substr(2, 9), 
                name: file.name, 
                duration: audio.duration, 
                startTime: 0, 
                previewUrl, 
                source: 'local' 
            }]);
        };
    };

    const generateSmartCaptions = async () => {
        if (mediaFiles.length === 0) return;
        setIsProcessingCaptions(true);
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
            setError("Smart Captions failed. Check API key.");
        } finally {
            setIsProcessingCaptions(false);
        }
    };

    const saveSlideshow = async () => {
        if (!user || mediaFiles.length === 0) { setError("Add content first."); return; }
        
        // Preserve sharedWith if it already exists
        let existingSharedWith: string[] = [];
        if (currentProjectId) {
            const docRef = doc(db, "slideshows", currentProjectId);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                existingSharedWith = docSnap.data().sharedWith || [];
            }
        }

        const projectData = {
            userId: user.uid,
            name: slideshowName || `Slideshow ${new Date().toLocaleDateString()}`,
            media: mediaFiles.map(({ previewUrl, ...rest }) => ({ ...rest, previewUrl: '' })), 
            audio: audioFiles.map(({ previewUrl, ...rest }) => ({ ...rest, previewUrl: '' })), 
            settings: settings,
            sharedWith: existingSharedWith, 
            timestamp: serverTimestamp()
        };

        try {
            if (currentProjectId) { 
                await updateDoc(doc(db, "slideshows", currentProjectId), projectData); 
                alert("Slideshow updated!"); 
            } else { 
                const docRef = await addDoc(collection(db, "slideshows"), projectData); 
                setCurrentProjectId(docRef.id); 
                alert("Slideshow saved to cloud!"); 
            }
        } catch (e: any) { setError("Cloud Save Error: " + e.message); }
    };

    const shareProject = async (id: string) => {
        const email = prompt("Enter the Google Account Email to share this with:");
        if (email && email.includes("@")) {
            try {
                await updateDoc(doc(db, "slideshows", id), {
                    sharedWith: arrayUnion(email.toLowerCase().trim())
                });
                alert(`Successfully shared with ${email}!`);
            } catch (e) {
                setError("Sharing failed. You must be the owner to share.");
            }
        }
    };

    const deleteSlideshow = async (id: string) => {
        if (confirm("Delete this slideshow?")) await deleteDoc(doc(db, "slideshows", id));
    };

    const handleAuthorizeApple = async () => {
        const mk = (window as any).MusicKit;
        if (mk) {
            try {
                const music = mk.getInstance();
                await music.authorize();
                setAppleMusicAuthorized(music.isAuthorized);
            } catch (err) { setError("Apple Music authorization failed."); }
        } else { setError("MusicKit not loaded."); }
    };

    const handleGoogleLogin = async () => {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
        } catch (e: any) {
            setError("Login failed: " + e.message);
        }
    };

    if (isLoading) return <div className="min-h-screen bg-brand-dark flex items-center justify-center"><div className="w-10 h-10 border-4 border-brand-purple border-t-transparent rounded-full animate-spin"></div></div>;

    return (
        <div className={`min-h-screen font-sans bg-brand-dark text-gray-200`}>
            <header className="p-4 flex justify-between items-center border-b border-gray-800 bg-gray-900/80 sticky top-0 z-40 backdrop-blur-xl">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-brand-purple rounded-lg flex items-center justify-center font-black text-white shadow-lg shadow-brand-purple/20">M</div>
                    <h1 className="text-xl font-bold tracking-tight text-white"><span className="text-brand-purple">Muziq</span> Slides</h1>
                </div>
                <div className="flex items-center gap-4">
                    {user && (
                        <nav className="flex bg-gray-800/50 p-1 rounded-xl border border-gray-700">
                            <button onClick={() => setViewMode('easy')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'easy' ? 'bg-brand-purple text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>Builder</button>
                            <button onClick={() => setViewMode('studio')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'studio' ? 'bg-brand-purple text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>Studio</button>
                        </nav>
                    )}
                    {user ? (
                        <div className="flex items-center gap-3">
                            <span className="hidden sm:inline text-xs font-bold text-gray-400">{user.email}</span>
                            <button onClick={() => signOut(auth)} className="text-xs bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg font-bold border border-gray-700 transition-colors">Logout</button>
                        </div>
                    ) : (
                        <button onClick={handleGoogleLogin} className="text-xs bg-brand-purple hover:bg-brand-purple/80 px-4 py-2 rounded-lg font-bold text-white shadow-lg transition-all">Sign In</button>
                    )}
                </div>
            </header>

            {!user ? (
                <main className="bg-white text-gray-900 min-h-screen overflow-x-hidden">
                    <section className="text-center pt-32 pb-24 px-4 bg-gradient-to-b from-brand-light to-white">
                        <h2 className="text-7xl font-black mb-8 tracking-tighter text-brand-dark leading-none">Memories,<br/>In <span className="text-brand-purple underline decoration-apple-red decoration-8 underline-offset-8">Perfect Sync</span></h2>
                        <p className="text-gray-500 mb-12 max-w-xl mx-auto text-xl leading-relaxed">The only cinematic slideshow builder perfectly synced with Apple Music.</p>
                        <div className="flex flex-col sm:flex-row gap-6 justify-center">
                            <button onClick={handleGoogleLogin} className="bg-brand-purple text-white px-12 py-5 rounded-full font-bold shadow-2xl hover:scale-105 transition-transform text-lg flex items-center justify-center gap-3">
                                <svg className="w-6 h-6" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                                Sign In with Google
                            </button>
                        </div>
                    </section>
                    <section id="about" className="py-24 px-4 bg-white border-y border-gray-100">
                        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-12">
                            <div className="space-y-6">
                                <h3 className="text-4xl font-black text-brand-dark tracking-tighter uppercase">Unlimited Creativity</h3>
                                <p className="text-gray-500 leading-relaxed">Muziq Slides is a simplified, high-performance editor for your life's best moments. Create beautiful photo streams with automated beat-matching and AI-powered poetic captions.</p>
                                <ul className="space-y-4 pt-4">
                                    <li className="flex gap-4">
                                        <div className="w-8 h-8 bg-brand-purple text-white rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0">✓</div>
                                        <span className="text-sm font-bold text-gray-700">20-Photo Cloud Uploads</span>
                                    </li>
                                    <li className="flex gap-4">
                                        <div className="w-8 h-8 bg-brand-purple text-white rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0">✓</div>
                                        <span className="text-sm font-bold text-gray-700">Apple Music Authorization</span>
                                    </li>
                                    <li className="flex gap-4">
                                        <div className="w-8 h-8 bg-brand-purple text-white rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0">✓</div>
                                        <span className="text-sm font-bold text-gray-700">Gemini AI Cinematic Captions</span>
                                    </li>
                                </ul>
                            </div>
                            <div className="bg-gray-50 p-10 rounded-[3rem] border border-gray-100 shadow-inner flex flex-col justify-center">
                                <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Social Sharing</p>
                                <p className="text-gray-500 text-sm leading-relaxed mb-6 italic">"Invite friends to your slideshow library by adding their Google email. No complex permissions, just shared memories in perfect sync."</p>
                                <button onClick={handleGoogleLogin} className="bg-brand-purple text-white py-4 rounded-full font-black uppercase tracking-widest text-xs shadow-lg">Get Started with Google</button>
                            </div>
                        </div>
                    </section>
                </main>
            ) : (
                <main className="p-4 max-w-7xl mx-auto grid lg:grid-cols-12 gap-8 py-8">
                    <div className="lg:col-span-4 space-y-6">
                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-xs font-black uppercase mb-4 text-brand-purple tracking-widest">Media (Max 20)</h3>
                            <div className="grid grid-cols-4 gap-2 mb-4">
                                <div className="aspect-square bg-gray-900/50 rounded-xl border-2 border-dashed border-gray-700 flex items-center justify-center relative hover:border-brand-purple cursor-pointer group">
                                    <input type="file" multiple accept="image/*,video/*" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                    <span className="text-2xl text-gray-500">＋</span>
                                </div>
                                {mediaFiles.map((m) => (
                                    <div key={m.id} className="aspect-square bg-gray-900 rounded-xl overflow-hidden relative border border-gray-800 group">
                                        <img src={m.previewUrl} className="w-full h-full object-cover" alt="" />
                                        <button onClick={() => setMediaFiles(p => p.filter(x => x.id !== m.id))} className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                                    </div>
                                ))}
                            </div>
                            {mediaFiles.length > 0 && (
                                <button onClick={generateSmartCaptions} disabled={isProcessingCaptions} className="w-full bg-brand-purple/10 text-brand-purple py-3 rounded-2xl text-[10px] font-black uppercase border border-brand-purple/20 hover:bg-brand-purple hover:text-white transition-all">
                                    {isProcessingCaptions ? 'Polishing...' : '✨ AI Smart Captions'}
                                </button>
                            )}
                        </section>

                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-xs font-black uppercase mb-4 text-brand-purple tracking-widest">Soundtrack</h3>
                            <div className="grid grid-cols-2 gap-2 mb-4">
                                <div className="relative">
                                    <button className="w-full bg-gray-800 border border-gray-700 py-3 rounded-xl text-[10px] font-black uppercase text-gray-400">Local Files</button>
                                    <input type="file" accept="audio/*" onChange={handleAudioUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                </div>
                                <button onClick={() => setIsMusicBrowserOpen(true)} className="w-full bg-apple-red/10 py-3 rounded-xl text-[10px] font-black uppercase text-apple-red border border-apple-red/30 hover:bg-apple-red hover:text-white">Apple Music</button>
                            </div>
                            <div className="space-y-2">
                                {audioFiles.map(a => (
                                    <div key={a.id} className="bg-gray-900/40 p-3 rounded-xl text-[10px] flex justify-between items-center border border-gray-800">
                                        <span className="truncate font-bold text-gray-300">{a.name}</span>
                                        <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))} className="text-gray-600 hover:text-red-500">🗑️</button>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-xs font-black uppercase mb-4 text-brand-purple tracking-widest">Transitions</h3>
                            <div className="grid grid-cols-2 gap-2">
                                {['ken-burns', 'fade-in', 'slide-from-right', 'zoom-in'].map(style => (
                                    <button key={style} onClick={() => setSettings(s => ({...s, slideStyle: style}))} className={`py-3 rounded-xl text-[10px] font-black uppercase border transition-all ${settings.slideStyle === style ? 'bg-brand-purple text-white shadow-lg' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                                        {style.replace(/-/g, ' ')}
                                    </button>
                                ))}
                            </div>
                        </section>
                    </div>

                    <div className="lg:col-span-8 space-y-8 animate-fade-in">
                        <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-gray-700/50">
                            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                                <input value={slideshowName} onChange={(e) => setSlideshowName(e.target.value)} placeholder="Untitled Slideshow..." className="bg-transparent text-4xl font-black text-white outline-none w-full placeholder:text-gray-800 tracking-tighter" />
                                <div className="flex gap-2">
                                    <button onClick={saveSlideshow} className="bg-gray-800 hover:bg-gray-700 text-white px-8 py-3 rounded-full text-xs font-bold border border-gray-700">Save Collection</button>
                                    <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="bg-brand-purple text-white px-10 py-3 rounded-full text-xs font-bold shadow-2xl hover:scale-105 active:scale-95 transition-all">Preview Final</button>
                                </div>
                            </div>
                            
                            <div className="aspect-video bg-gray-950 rounded-[3rem] relative overflow-hidden border border-gray-800 flex items-center justify-center">
                                {mediaFiles.length > 0 ? (
                                    <div className="w-full h-full relative">
                                        <img src={mediaFiles[0].previewUrl} className="w-full h-full object-cover opacity-20 blur-sm scale-110" alt="" />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="w-24 h-24 bg-brand-purple rounded-full flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-transform">
                                                <svg className="w-10 h-10 text-white ml-2" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center p-12 opacity-20">
                                        <div className="w-20 h-20 bg-gray-900 border border-gray-800 rounded-[2rem] flex items-center justify-center mx-auto mb-6 text-3xl">🎬</div>
                                        <p className="text-xs font-black uppercase tracking-widest">Workspace Empty</p>
                                    </div>
                                )}
                            </div>
                        </section>

                        <section className="space-y-6">
                            <div className="flex justify-between items-center">
                                <h3 className="text-xs font-black uppercase text-gray-500 tracking-widest">My Collections</h3>
                                <div className="h-px bg-gray-800 flex-1 mx-6"></div>
                            </div>
                            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
                                {ownedSlideshows.map(ss => (
                                    <div key={ss.id} className="bg-gray-800/20 p-6 rounded-[2.5rem] flex flex-col group border border-gray-800 hover:border-brand-purple/40 transition-all">
                                        <div className="aspect-square bg-gray-900 rounded-[2rem] mb-5 overflow-hidden relative border border-gray-800/50">
                                            {ss.media[0] && <img src={ss.media[0].previewUrl} className="w-full h-full object-cover opacity-40 group-hover:scale-105 transition-transform" alt="" />}
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                                                <button onClick={() => loadProject(ss)} className="bg-white text-brand-dark px-6 py-2.5 rounded-full font-bold text-xs shadow-xl">Edit Project</button>
                                            </div>
                                        </div>
                                        <h4 className="font-bold truncate text-sm mb-1 text-gray-200">{ss.name}</h4>
                                        <p className="text-[10px] text-gray-600 mb-5 font-bold uppercase tracking-widest">{ss.media.length} Slides • {ss.sharedWith?.length || 0} Shared</p>
                                        <div className="flex gap-2">
                                            <button onClick={() => loadProject(ss)} className="flex-1 bg-brand-purple/10 text-brand-purple py-2.5 rounded-2xl text-[10px] font-black uppercase hover:bg-brand-purple hover:text-white transition-colors">Load</button>
                                            <button onClick={() => shareProject(ss.id)} className="flex-1 bg-gray-800 text-gray-400 py-2.5 rounded-2xl text-[10px] font-black uppercase hover:bg-gray-700 transition-colors">Share</button>
                                            <button onClick={() => deleteSlideshow(ss.id)} className="px-4 bg-red-500/10 text-red-500 py-2.5 rounded-2xl text-[10px] font-black hover:bg-red-500 hover:text-white transition-colors">🗑️</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="space-y-6">
                            <div className="flex justify-between items-center">
                                <h3 className="text-xs font-black uppercase text-gray-500 tracking-widest">Shared With Me</h3>
                                <div className="h-px bg-gray-800 flex-1 mx-6"></div>
                            </div>
                            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
                                {sharedSlideshows.map(ss => (
                                    <div key={ss.id} className="bg-gray-800/20 p-6 rounded-[2.5rem] flex flex-col group border border-gray-800 hover:border-brand-purple/40 transition-all">
                                        <div className="aspect-square bg-gray-900 rounded-[2rem] mb-5 overflow-hidden relative border border-gray-800/50">
                                            {ss.media[0] && <img src={ss.media[0].previewUrl} className="w-full h-full object-cover opacity-40 group-hover:scale-105 transition-transform" alt="" />}
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                                                <button onClick={() => loadProject(ss)} className="bg-white text-brand-dark px-6 py-2.5 rounded-full font-bold text-xs shadow-xl">View Project</button>
                                            </div>
                                        </div>
                                        <h4 className="font-bold truncate text-sm mb-1 text-gray-200">{ss.name}</h4>
                                        <p className="text-[10px] text-gray-600 mb-5 font-bold uppercase tracking-widest">Received via Share</p>
                                        <button onClick={() => loadProject(ss)} className="w-full bg-brand-purple text-white py-2.5 rounded-2xl text-[10px] font-black uppercase shadow-lg hover:scale-105 transition-transform">Play Shared Show</button>
                                    </div>
                                ))}
                                {sharedSlideshows.length === 0 && (
                                    <div className="col-span-full py-10 bg-gray-900/40 rounded-[3rem] border border-dashed border-gray-800 text-center opacity-20">
                                        <p className="text-[10px] font-black uppercase tracking-widest">No shared shows received</p>
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>
                </main>
            )}

            {isMusicBrowserOpen && (
                <div className="fixed inset-0 bg-black/95 z-[500] flex items-center justify-center p-6 backdrop-blur-2xl animate-fade-in">
                    <div className="bg-gray-950 w-full max-w-2xl h-[80vh] rounded-[4rem] border border-gray-800 p-12 flex flex-col shadow-2xl">
                        <div className="flex justify-between items-center mb-12">
                            <div>
                                <h2 className="text-3xl font-black uppercase tracking-tighter text-white">Apple Music</h2>
                            </div>
                            <button onClick={() => setIsMusicBrowserOpen(false)} className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center text-gray-500 hover:text-white transition-all">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                            {!appleMusicAuthorized && !isSimulationMode ? (
                                <div className="text-center py-20 bg-gray-900/50 rounded-[3rem] border border-gray-800">
                                    <div className="w-20 h-20 bg-apple-red/20 text-apple-red rounded-[2rem] flex items-center justify-center mx-auto mb-8 text-3xl shadow-xl"></div>
                                    <h3 className="text-xl font-bold mb-4 text-white">Connect Library</h3>
                                    <p className="text-xs text-gray-500 mb-10 max-w-xs mx-auto leading-relaxed">Authorize Muziq Slides to browse your Apple Music library.</p>
                                    <button onClick={handleAuthorizeApple} className="bg-apple-red text-white px-12 py-4 rounded-full font-bold shadow-2xl text-sm uppercase tracking-widest">Authorize Now</button>
                                    <button onClick={() => setIsSimulationMode(true)} className="block w-full mt-6 text-[10px] uppercase font-black text-gray-600 hover:text-brand-purple">Or use simulation mode</button>
                                </div>
                            ) : (
                                <div className="grid gap-4">
                                    {MOCK_TRACKS.map(track => (
                                        <div key={track.id} className="bg-gray-900/60 p-5 rounded-[2rem] border border-gray-800 flex justify-between items-center hover:border-brand-purple group cursor-pointer transition-all hover:bg-gray-900 shadow-sm" onClick={() => { setAudioFiles(p => [...p, { ...track, startTime: 0, previewUrl: '' }]); setIsMusicBrowserOpen(false); }}>
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-gray-800 rounded-2xl flex items-center justify-center text-xl">🎵</div>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-gray-100 text-sm">{track.name}</span>
                                                    <span className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">{Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2,'0')}</span>
                                                </div>
                                            </div>
                                            <button className="bg-brand-purple/10 text-brand-purple px-6 py-2 rounded-xl text-[10px] font-black uppercase group-hover:bg-brand-purple group-hover:text-white transition-all">Add Track</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {isPlaying && (
                <div className="fixed inset-0 bg-black z-[600] flex flex-col items-center justify-center cursor-none animate-fade-in">
                    <button onClick={() => setIsPlaying(false)} className="absolute top-10 right-10 text-white/30 hover:text-white p-5 z-[610] text-3xl transition-all cursor-pointer">✕</button>
                    <div className="w-full h-full relative overflow-hidden flex items-center justify-center">
                        {mediaWithTimestamps.map((m, idx) => (
                            <TheaterMedia key={m.id} media={m} isVisible={idx === currentSlide} slideStyle={settings.slideStyle} showCaptions={settings.showCaptions} />
                        ))}
                    </div>
                    <div className="absolute bottom-0 left-0 h-1.5 bg-brand-purple z-[620] transition-all duration-200 shadow-[0_0_20px_rgba(109,40,217,0.8)]" style={{ width: `${(elapsedTime / totalSlideshowDuration) * 100}%` }}></div>
                </div>
            )}
            
            {error && (
                <div className="fixed bottom-10 right-10 bg-red-600 text-white p-6 rounded-[2rem] shadow-2xl z-[700] flex gap-6 items-center border border-white/20 animate-slide-from-bottom">
                    <p className="text-sm font-bold">{error}</p>
                    <button onClick={() => setError(null)} className="ml-4 p-2 hover:bg-white/10 rounded-full transition-colors font-black">✕</button>
                </div>
            )}
        </div>
    );
};

export default App;
