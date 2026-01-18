
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

// --- JWT UTILITY FOR APPLE MUSIC ---
async function generateAppleMusicJWT(keyId: string, teamId: string, privateKeyPEM: string): Promise<string> {
    const header = { alg: 'ES256', kid: keyId };
    const payload = {
        iss: teamId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (3600 * 24), // 24 hours
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

// --- IMAGE COMPRESSION UTILITY ---
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
    sharedWith?: string[];
}

// --- MOCK DATA ---
const MOCK_TRACKS: AppStateAudio[] = [
    { id: 'm1', name: 'Golden Hour Memories', duration: 184, startTime: 0, previewUrl: '', source: 'apple-music' },
    { id: 'm2', name: 'Midnight City Lights', duration: 215, startTime: 0, previewUrl: '', source: 'apple-music' },
    { id: 'm3', name: 'Ocean Breeze Whispers', duration: 142, startTime: 0, previewUrl: '', source: 'apple-music' },
    { id: 'm4', name: 'Mountain Peak Sunrise', duration: 198, startTime: 0, previewUrl: '', source: 'apple-music' },
    { id: 'm5', name: 'Urban Echoes', duration: 167, startTime: 0, previewUrl: '', source: 'apple-music' },
];

// --- SUB-COMPONENTS ---
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
        const unsubscribe = onAuthStateChanged(auth, async (u) => { 
            setUser(u); 
            setIsLoading(false); 
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        const teamId = process.env.TEAM_ID;
        const keyId = process.env.KEY_ID;
        const authToken = process.env.AUTH_TOKEN;

        if (teamId && keyId && authToken) {
            generateAppleMusicJWT(keyId, teamId, authToken).then(token => {
                const initMK = () => {
                    const mk = (window as any).MusicKit;
                    if (mk) {
                        mk.configure({
                            developerToken: token,
                            app: { name: 'Muziq Slides', build: '1.0.0' }
                        });
                        setAppleMusicAuthorized(mk.getInstance().isAuthorized);
                    }
                };
                if (!(window as any).MusicKit) {
                    const script = document.createElement('script');
                    script.src = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
                    script.onload = initMK;
                    document.head.appendChild(script);
                } else {
                    initMK();
                }
            }).catch(e => {
                console.warn("JWT/MusicKit setup failed, using simulation mode", e);
                setIsSimulationMode(true);
            });
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
                const media = reconstructMedia(data.media);
                return { id: d.id, ...data, media } as SavedSlideshow;
            });
            setOwnedSlideshows(projects);
        });
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

    const handleAuthorizeApple = async () => {
        const mk = (window as any).MusicKit;
        if (mk) {
            try {
                const music = mk.getInstance();
                await music.authorize();
                setAppleMusicAuthorized(music.isAuthorized);
            } catch (err) {
                console.error("MusicKit Authorization error", err);
                setError("Apple Music authorization failed.");
            }
        } else {
            setError("MusicKit not loaded.");
        }
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
        const totalSize = mediaFiles.reduce((acc, curr) => acc + (curr.base64?.length || 0), 0);
        if (totalSize > 900000) { setError("Project too large. Use fewer photos."); return; }

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
                alert("Slideshow updated!"); 
            } else { 
                const docRef = await addDoc(collection(db, "slideshows"), projectData); 
                setCurrentProjectId(docRef.id); 
                alert("Slideshow saved!"); 
            }
        } catch (e: any) { setError("Cloud Save Error: " + e.message); }
    };

    const deleteSlideshow = async (id: string) => {
        if (confirm("Delete this slideshow?")) await deleteDoc(doc(db, "slideshows", id));
    };

    const shareProject = (id: string) => {
        const url = `${window.location.origin}${window.location.pathname}?id=${id}`;
        navigator.clipboard.writeText(url);
        alert("Link copied to clipboard! Share it with anyone.");
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
                            <button onClick={() => setViewMode('easy')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'easy' ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/20' : 'text-gray-400 hover:text-white'}`}>Builder</button>
                            <button onClick={() => setViewMode('studio')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'studio' ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/20' : 'text-gray-400 hover:text-white'}`}>Studio</button>
                        </nav>
                    )}
                    {user ? <button onClick={() => signOut(auth)} className="text-xs bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg font-bold border border-gray-700 transition-colors">Logout</button> : <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="text-xs bg-brand-purple hover:bg-brand-purple/80 px-4 py-2 rounded-lg font-bold text-white shadow-lg shadow-brand-purple/20 transition-all">Sign In</button>}
                </div>
            </header>

            {!user ? (
                <main className="bg-white text-gray-900 min-h-screen overflow-x-hidden">
                    <section className="text-center pt-32 pb-24 px-4 bg-gradient-to-b from-brand-light to-white">
                        <h2 className="text-7xl font-black mb-8 tracking-tighter text-brand-dark leading-none">Memories,<br/>In <span className="text-brand-purple underline decoration-apple-red decoration-8 underline-offset-8">Perfect Sync</span></h2>
                        <p className="text-gray-500 mb-12 max-w-xl mx-auto text-xl leading-relaxed">The only cinematic slideshow builder perfectly synced with Apple Music.</p>
                        <div className="flex flex-col sm:flex-row gap-6 justify-center">
                            <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="bg-brand-purple text-white px-12 py-5 rounded-full font-bold shadow-2xl hover:scale-105 transition-transform text-lg">Get Started Free</button>
                            <a href="#about" className="px-12 py-5 rounded-full font-bold text-brand-dark border-2 border-brand-dark/10 hover:bg-brand-dark/5 transition-colors text-lg">Learn More</a>
                        </div>
                    </section>

                    <section id="about" className="py-24 px-4 bg-white border-y border-gray-100">
                        <div className="max-w-4xl mx-auto">
                            <h3 className="text-4xl font-black mb-12 text-brand-dark uppercase tracking-tighter text-center">Core Features</h3>
                            <div className="grid md:grid-cols-2 gap-8">
                              <div className="p-8 border border-gray-200 rounded-[2.5rem]">
                                <h4 className="text-2xl font-black mb-4">Unlimited Creation</h4>
                                <ul className="space-y-3 text-gray-500 text-sm">
                                  <li>• Up to 20 images per show</li>
                                  <li>• High-performance transitions</li>
                                  <li>• Cloud storage for your projects</li>
                                  <li>• Mobile-ready viewing</li>
                                </ul>
                              </div>
                              <div className="p-8 bg-brand-purple text-white rounded-[2.5rem] shadow-2xl relative overflow-hidden">
                                <h4 className="text-2xl font-black mb-4">Smart Tools</h4>
                                <ul className="space-y-3 text-white/80 text-sm mb-8">
                                  <li>• Apple Music Integration</li>
                                  <li>• AI-Generated Cinematic Captions</li>
                                  <li>• Multi-track Studio Timeline</li>
                                  <li>• Instant Link Sharing</li>
                                </ul>
                                <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="w-full bg-white text-brand-purple py-4 rounded-full font-black text-sm uppercase">Create Your First Show</button>
                              </div>
                            </div>
                        </div>
                    </section>
                </main>
            ) : (
                <main className="p-4 max-w-7xl mx-auto grid lg:grid-cols-12 gap-8 py-8">
                    {viewMode === 'studio' ? (
                        <div className="lg:col-span-12 space-y-8 animate-fade-in">
                            <section className="bg-gray-800/30 p-8 rounded-[3rem] border border-gray-700/50">
                                <div className="flex justify-between items-center mb-8">
                                    <div>
                                        <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Studio Timeline</h2>
                                        <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mt-1">Fine-tune Audio Sync</p>
                                    </div>
                                    <div className="flex gap-2">
                                      <button onClick={saveSlideshow} className="bg-brand-purple text-white px-8 py-3 rounded-full text-xs font-bold shadow-xl shadow-brand-purple/20 hover:scale-105 transition-all">Save Project</button>
                                    </div>
                                </div>

                                <div className="space-y-6 overflow-x-auto pb-6">
                                    <div className="flex gap-1 relative h-20 items-end bg-gray-900/50 rounded-2xl p-4 border border-gray-800">
                                        <span className="absolute top-2 left-4 text-[9px] uppercase font-black text-gray-600">Visuals Track</span>
                                        {mediaWithTimestamps.map((m, i) => (
                                            <div key={m.id} className="h-10 bg-gray-800 rounded-md overflow-hidden border border-gray-700 relative group flex-shrink-0" style={{ width: `${(m.timelineEnd! - m.timelineStart!) * 20}px` }}>
                                                <img src={m.previewUrl} className="w-full h-full object-cover opacity-50" alt="" />
                                            </div>
                                        ))}
                                    </div>

                                    <div className="space-y-2">
                                        {audioFiles.map((a, i) => (
                                            <div key={a.id} className="relative h-16 bg-apple-red/10 border border-apple-red/20 rounded-2xl group flex items-center px-4" style={{ marginLeft: `${a.startTime * 20}px`, width: `${a.duration * 20}px` }}>
                                                <div className="flex flex-col truncate">
                                                    <span className="text-[10px] font-black uppercase text-apple-red truncate">{a.name}</span>
                                                    <span className="text-[8px] text-apple-red/60 font-mono">Start: {a.startTime}s • Dur: {Math.floor(a.duration)}s</span>
                                                </div>
                                                <div className="absolute inset-0 flex items-center justify-end px-4 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-l from-gray-900/80 to-transparent rounded-2xl">
                                                    <div className="flex items-center gap-2">
                                                        <label className="text-[9px] font-bold uppercase text-gray-400">Offset:</label>
                                                        <input 
                                                            type="number" 
                                                            value={a.startTime} 
                                                            onChange={(e) => {
                                                                const val = parseInt(e.target.value) || 0;
                                                                setAudioFiles(p => p.map(x => x.id === a.id ? {...x, startTime: val} : x));
                                                            }}
                                                            className="w-12 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px] text-white"
                                                        />
                                                        <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))} className="text-red-500 hover:text-white transition-colors">🗑️</button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        {audioFiles.length === 0 && <p className="text-center py-10 text-[10px] text-gray-600 uppercase tracking-widest">No soundtrack tracks added yet.</p>}
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
                                        Media Library
                                    </h3>
                                    <div className="grid grid-cols-4 gap-2 mb-4">
                                        <div className="aspect-square bg-gray-900/50 rounded-xl border-2 border-dashed border-gray-700 flex items-center justify-center relative hover:border-brand-purple transition-colors cursor-pointer group">
                                            <input type="file" multiple accept="image/*,video/*" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                            <span className="text-2xl group-hover:scale-125 transition-transform text-gray-500">＋</span>
                                        </div>
                                        {mediaFiles.map((m) => (
                                            <div key={m.id} className="aspect-square bg-gray-900 rounded-xl overflow-hidden relative border border-gray-800 group">
                                                <img src={m.previewUrl} className="w-full h-full object-cover" alt="" />
                                                <button onClick={() => setMediaFiles(p => p.filter(x => x.id !== m.id))} className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                                            </div>
                                        ))}
                                    </div>
                                    {mediaFiles.length > 0 && (
                                        <button onClick={generateSmartCaptions} disabled={isProcessingCaptions} className="w-full bg-brand-purple/10 text-brand-purple py-3 rounded-2xl text-[10px] font-black uppercase border border-brand-purple/20 flex items-center justify-center gap-2 hover:bg-brand-purple hover:text-white transition-all shadow-lg shadow-brand-purple/5">
                                            {isProcessingCaptions ? <div className="w-3 h-3 border-2 border-brand-purple border-t-transparent rounded-full animate-spin"></div> : '✨'}
                                            {isProcessingCaptions ? 'Polishing...' : 'AI Smart Captions'}
                                        </button>
                                    )}
                                </section>

                                <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                                    <h3 className="text-sm font-black uppercase mb-4 text-brand-purple tracking-widest flex items-center gap-2">
                                        <span className="bg-brand-purple text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">2</span>
                                        Soundtrack
                                    </h3>
                                    <div className="grid grid-cols-2 gap-2 mb-4">
                                        <div className="relative">
                                            <button className="w-full bg-gray-800 border border-gray-700 py-3 rounded-xl text-[10px] font-black uppercase text-gray-400 hover:text-white hover:border-gray-500 transition-all">Choose Files</button>
                                            <input type="file" accept="audio/*" onChange={handleAudioUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                        </div>
                                        <button onClick={() => setIsMusicBrowserOpen(true)} className="w-full bg-apple-red/10 py-3 rounded-xl text-[10px] font-black uppercase text-apple-red border border-apple-red/30 hover:bg-apple-red hover:text-white transition-all">Browse Apple</button>
                                    </div>
                                    <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1">
                                        {audioFiles.map(a => (
                                            <div key={a.id} className="bg-gray-900/40 p-3 rounded-xl text-[10px] flex justify-between items-center border border-gray-800">
                                                <div className="truncate flex flex-col gap-0.5">
                                                    <span className="text-gray-500 uppercase tracking-tighter text-[8px] font-black">{a.source}</span>
                                                    <span className="truncate font-bold text-gray-300">{a.name}</span>
                                                </div>
                                                <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))} className="text-gray-600 hover:text-red-500">🗑️</button>
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                                    <h3 className="text-sm font-black uppercase mb-4 text-brand-purple tracking-widest flex items-center gap-2">
                                        <span className="bg-brand-purple text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">3</span>
                                        Transitions
                                    </h3>
                                    <div className="grid grid-cols-2 gap-2">
                                        {['ken-burns', 'fade-in', 'slide-from-right', 'zoom-in'].map(style => (
                                            <button 
                                                key={style} 
                                                onClick={() => setSettings(s => ({...s, slideStyle: style}))} 
                                                className={`py-3 rounded-xl text-[10px] font-black uppercase border transition-all ${settings.slideStyle === style ? 'bg-brand-purple border-brand-purple text-white shadow-lg shadow-brand-purple/20' : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600'}`}
                                            >
                                                {style.replace(/-/g, ' ')}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="mt-4">
                                        <label className="text-[10px] font-black uppercase text-gray-500 tracking-widest mb-2 block">Slide Interval</label>
                                        <input 
                                            type="range" min="2" max="15" 
                                            value={settings.interval} 
                                            onChange={(e) => setSettings(s => ({...s, interval: parseInt(e.target.value)}))}
                                            className="w-full accent-brand-purple"
                                        />
                                        <div className="flex justify-between text-[10px] font-bold text-gray-600 mt-1">
                                            <span>2s</span>
                                            <span className="text-brand-purple">{settings.interval}s</span>
                                            <span>15s</span>
                                        </div>
                                    </div>
                                </section>
                            </div>

                            <div className="lg:col-span-8 space-y-8 animate-fade-in">
                                <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-gray-700/50 relative overflow-hidden">
                                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 relative z-10">
                                        <input 
                                            value={slideshowName} 
                                            onChange={(e) => setSlideshowName(e.target.value)} 
                                            placeholder="Untitled Collection..." 
                                            className="bg-transparent text-4xl font-black text-white outline-none w-full mr-4 placeholder:text-gray-800 tracking-tighter" 
                                        />
                                        <div className="flex gap-2 shrink-0">
                                            <button onClick={saveSlideshow} className="bg-gray-800 hover:bg-gray-700 text-white px-8 py-3 rounded-full text-xs font-bold border border-gray-700 transition-all">
                                                {currentProjectId ? 'Update' : 'Save'}
                                            </button>
                                            <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="bg-brand-purple text-white px-10 py-3 rounded-full text-xs font-bold shadow-2xl shadow-brand-purple/30 hover:scale-105 active:scale-95 transition-all">Preview Slideshow</button>
                                        </div>
                                    </div>
                                    
                                    <div className="aspect-video bg-gray-950 rounded-[3rem] relative overflow-hidden border border-gray-800 shadow-2xl flex items-center justify-center group">
                                        {mediaFiles.length > 0 ? (
                                            <div className="w-full h-full relative">
                                                <img src={mediaFiles[0].previewUrl} className="w-full h-full object-cover opacity-20 blur-sm scale-110" alt="" />
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="w-24 h-24 bg-brand-purple rounded-full flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-transform group-hover:bg-brand-purple/80">
                                                        <svg className="w-10 h-10 text-white ml-2" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-center p-12">
                                                <div className="w-20 h-20 bg-gray-900 border border-gray-800 rounded-[2rem] flex items-center justify-center mx-auto mb-6 text-3xl opacity-20">🎬</div>
                                                <p className="text-xs text-gray-700 uppercase font-black tracking-widest">Workspace Empty</p>
                                            </div>
                                        )}
                                    </div>
                                </section>

                                <section>
                                    <div className="flex justify-between items-center mb-8">
                                        <h3 className="text-xs font-black uppercase text-gray-500 tracking-widest">Saved Collections</h3>
                                        <div className="h-px bg-gray-800 flex-1 mx-6"></div>
                                    </div>
                                    <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
                                        {ownedSlideshows.map(ss => (
                                            <div key={ss.id} className="bg-gray-800/20 p-6 rounded-[2.5rem] flex flex-col group border border-gray-800 hover:border-brand-purple/40 transition-all hover:bg-gray-800/30">
                                                <div className="aspect-square bg-gray-900 rounded-[2rem] mb-5 overflow-hidden relative border border-gray-800/50">
                                                    {ss.media[0] && <img src={ss.media[0].previewUrl} className="w-full h-full object-cover opacity-40 group-hover:scale-105 transition-transform" alt="" />}
                                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                                                        <button onClick={() => loadProject(ss)} className="bg-white text-brand-dark px-6 py-2.5 rounded-full font-bold text-xs shadow-2xl hover:scale-105 active:scale-95 transition-all">Edit Project</button>
                                                    </div>
                                                </div>
                                                <h4 className="font-bold truncate text-sm mb-1 text-gray-200">{ss.name}</h4>
                                                <p className="text-[10px] text-gray-600 mb-5 font-bold uppercase tracking-widest">{ss.media.length} Slides • {ss.audio.length} Tracks</p>
                                                <div className="flex gap-2">
                                                    <button onClick={() => loadProject(ss)} className="flex-1 bg-brand-purple/10 text-brand-purple py-2.5 rounded-2xl text-[10px] font-black uppercase hover:bg-brand-purple hover:text-white transition-all">Load</button>
                                                    <button onClick={() => shareProject(ss.id)} className="flex-1 bg-gray-800 text-gray-400 py-2.5 rounded-2xl text-[10px] font-black uppercase hover:text-brand-purple hover:bg-brand-purple/5 transition-all">Share</button>
                                                    <button onClick={() => deleteSlideshow(ss.id)} className="px-4 bg-red-500/10 text-red-500 py-2.5 rounded-2xl text-[10px] font-black hover:bg-red-500 hover:text-white transition-all">🗑️</button>
                                                </div>
                                            </div>
                                        ))}
                                        {ownedSlideshows.length === 0 && (
                                            <div className="col-span-full py-20 bg-gray-900/40 rounded-[3rem] border border-dashed border-gray-800 text-center">
                                                <p className="text-gray-700 text-[10px] font-black uppercase tracking-[0.2em]">No Collections Found in Cloud</p>
                                            </div>
                                        )}
                                    </div>
                                </section>
                            </div>
                        </>
                    )}
                </main>
            )}

            {isMusicBrowserOpen && (
                <div className="fixed inset-0 bg-black/95 z-[500] flex items-center justify-center p-6 backdrop-blur-2xl animate-fade-in">
                    <div className="bg-gray-950 w-full max-w-2xl h-[80vh] rounded-[4rem] border border-gray-800 p-12 flex flex-col shadow-2xl">
                        <div className="flex justify-between items-center mb-12">
                            <div>
                                <h2 className="text-3xl font-black uppercase tracking-tighter text-white">Music Browser</h2>
                                <p className="text-[10px] text-brand-purple font-black uppercase tracking-[0.2em] mt-2">Personalize your Soundtrack</p>
                            </div>
                            <button onClick={() => setIsMusicBrowserOpen(false)} className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-800 hover:text-white transition-all">✕</button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
                            {!appleMusicAuthorized && !isSimulationMode ? (
                                <div className="text-center py-20 bg-gray-900/50 rounded-[3rem] border border-gray-800">
                                    <div className="w-20 h-20 bg-apple-red/20 text-apple-red rounded-[2rem] flex items-center justify-center mx-auto mb-8 text-3xl shadow-xl shadow-apple-red/10 animate-pulse"></div>
                                    <h3 className="text-xl font-bold mb-4 text-white">Apple Music Library</h3>
                                    <p className="text-xs text-gray-500 mb-10 max-w-xs mx-auto leading-relaxed">Authorize to browse your personal playlists and library directly in the editor.</p>
                                    <button onClick={handleAuthorizeApple} className="bg-apple-red text-white px-12 py-4 rounded-full font-bold shadow-2xl shadow-apple-red/30 hover:scale-105 transition-all text-sm uppercase tracking-widest">Authorize Access</button>
                                    <button onClick={() => setIsSimulationMode(true)} className="block w-full mt-6 text-[10px] uppercase font-black text-gray-600 hover:text-brand-purple">Or use simulation mode</button>
                                </div>
                            ) : (
                                <div className="grid gap-4">
                                    <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest mb-2">Simulated Collection</p>
                                    {MOCK_TRACKS.map(track => (
                                        <div 
                                            key={track.id} 
                                            className="bg-gray-900/60 p-5 rounded-[2rem] border border-gray-800 flex justify-between items-center hover:border-brand-purple group cursor-pointer transition-all hover:bg-gray-900 shadow-sm"
                                            onClick={() => {
                                                setAudioFiles(p => [...p, { ...track, startTime: 0, previewUrl: '' }]);
                                                setIsMusicBrowserOpen(false);
                                            }}
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-gray-800 rounded-2xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform shadow-inner">🎵</div>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-gray-100 text-sm">{track.name}</span>
                                                    <span className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">Digital • {Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2,'0')}</span>
                                                </div>
                                            </div>
                                            <button className="bg-brand-purple/10 text-brand-purple px-6 py-2 rounded-xl text-[10px] font-black uppercase group-hover:bg-brand-purple group-hover:text-white transition-all shadow-md">Add</button>
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
                    {audioFiles.map(a => {
                        const isActive = elapsedTime >= a.startTime && elapsedTime < (a.startTime + a.duration);
                        return a.previewUrl ? (
                            <audio 
                                key={a.id} 
                                src={a.previewUrl} 
                                autoPlay={isActive}
                                hidden 
                                ref={(el) => {
                                    if (el) {
                                        if (isActive) {
                                            if (el.paused) el.play().catch(() => {});
                                            const targetTime = elapsedTime - a.startTime;
                                            if (Math.abs(el.currentTime - targetTime) > 0.3) el.currentTime = targetTime;
                                        } else {
                                            if (!el.paused) el.pause();
                                        }
                                    }
                                }}
                            />
                        ) : null;
                    })}
                    <div className="absolute bottom-0 left-0 h-1.5 bg-brand-purple z-[620] transition-all duration-200 shadow-[0_0_20px_rgba(109,40,217,0.8)]" style={{ width: `${(elapsedTime / totalSlideshowDuration) * 100}%` }}></div>
                </div>
            )}
            
            {error && (
                <div className="fixed bottom-10 right-10 bg-red-600 text-white p-6 rounded-[2rem] shadow-2xl z-[700] flex gap-6 items-center border border-white/20 animate-slide-from-bottom">
                    <div className="text-2xl">⚠️</div>
                    <div>
                        <p className="text-xs font-black uppercase tracking-widest mb-1">System Error</p>
                        <p className="text-sm font-bold opacity-90">{error}</p>
                    </div>
                    <button onClick={() => setError(null)} className="ml-4 p-2 hover:bg-white/10 rounded-full transition-colors font-black">✕</button>
                </div>
            )}
        </div>
    );
};

export default App;
