
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
}

// --- SUB-COMPONENTS ---
const TheaterMedia: React.FC<{
    media: MediaFile;
    isVisible: boolean;
    slideStyle: string;
    showCaptions: boolean;
}> = ({ media, isVisible, slideStyle, showCaptions }) => {
    const animationClass = isVisible ? `animate-${slideStyle}` : 'opacity-0 pointer-events-none';
    const mediaUrl = (media.base64 && !media.previewUrl) ? `data:image/jpeg;base64,${media.base64}` : media.previewUrl;

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

    // Initializing Gemini API
    const ai = useMemo(() => new GoogleGenAI({ apiKey: process.env.API_KEY as string }), []);

    const reconstructMedia = useCallback((media: MediaFile[]) => {
        return (media || []).map(m => {
            if (m.base64 && (!m.previewUrl || m.previewUrl === '' || m.previewUrl.startsWith('blob:'))) {
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
        return unsubscribe;
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
        // Fix: Explicitly cast Array.from result to File[] to avoid TypeScript error on line 266
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

    const generateSmartCaptions = async () => {
        if (mediaFiles.length === 0) return;
        setIsProcessingCaptions(true);
        try {
            const updatedMedia = await Promise.all(mediaFiles.map(async (m) => {
                if (m.type === 'video' || !m.base64) return m;
                // Using Gemini 3 Flash for basic multimodal analysis
                const response = await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: {
                      parts: [
                        { text: "Analyze this photo and write a cinematic, one-sentence nostalgic caption. Keep it evocative and short. Poem-like." },
                        { inlineData: { mimeType: 'image/jpeg', data: m.base64 } }
                      ]
                    }
                });
                // Correctly accessing .text property on GenerateContentResponse
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
                alert("Collection updated!"); 
            } else { 
                const docRef = await addDoc(collection(db, "slideshows"), projectData); 
                setCurrentProjectId(docRef.id); 
                alert("Collection saved!"); 
            }
        } catch (e: any) { setError("Cloud Save Error: " + e.message); }
    };

    const deleteSlideshow = async (id: string) => {
        if (confirm("Delete this collection?")) await deleteDoc(doc(db, "slideshows", id));
    };

    if (isLoading) return <div className="min-h-screen bg-brand-dark flex items-center justify-center"><div className="w-10 h-10 border-4 border-brand-purple border-t-transparent rounded-full animate-spin"></div></div>;

    return (
        <div className={`min-h-screen font-sans bg-brand-dark text-gray-200`}>
            <header className="p-4 flex justify-between items-center border-b border-gray-800 bg-gray-900/80 sticky top-0 z-40 backdrop-blur-xl">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-brand-purple rounded-lg flex items-center justify-center font-black text-white">M</div>
                    <h1 className="text-xl font-bold tracking-tight text-white"><span className="text-brand-purple">Muziq</span> Slides</h1>
                </div>
                <div className="flex items-center gap-4">
                    {user && (
                        <nav className="flex bg-gray-800/50 p-1 rounded-xl border border-gray-700">
                            <button onClick={() => setViewMode('easy')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'easy' ? 'bg-brand-purple text-white' : 'text-gray-400'}`}>Builder</button>
                            <button onClick={() => setViewMode('studio')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'studio' ? 'bg-brand-purple text-white' : 'text-gray-400'}`}>Studio</button>
                        </nav>
                    )}
                    {user ? <button onClick={() => signOut(auth)} className="text-xs bg-gray-800 px-4 py-2 rounded-lg font-bold">Logout</button> : <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="text-xs bg-brand-purple px-4 py-2 rounded-lg font-bold text-white shadow-lg shadow-brand-purple/20">Sign In</button>}
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
                            <h3 className="text-4xl font-black mb-12 text-brand-dark uppercase tracking-tighter text-center">About & Key Features</h3>
                            <div className="grid md:grid-cols-2 gap-12 mb-16">
                                <div className="space-y-6">
                                    <div className="flex gap-4">
                                        <div className="w-10 h-10 bg-brand-purple rounded-2xl flex items-center justify-center text-white font-black flex-shrink-0 shadow-lg shadow-brand-purple/20">1</div>
                                        <div>
                                            <h4 className="font-black text-brand-dark uppercase text-sm tracking-wider mb-2">Upload Up to 20 Photos</h4>
                                            <p className="text-gray-500 text-sm leading-relaxed">Images are auto-compressed to ensure they sync perfectly to your private cloud library.</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-4">
                                        <div className="w-10 h-10 bg-brand-purple rounded-2xl flex items-center justify-center text-white font-black flex-shrink-0 shadow-lg shadow-brand-purple/20">2</div>
                                        <div>
                                            <h4 className="font-black text-brand-dark uppercase text-sm tracking-wider mb-2">Apple Music Sync</h4>
                                            <p className="text-gray-500 text-sm leading-relaxed">Connect your library or use curated simulation tracks. Precisely time your music in the Studio Timeline.</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-4">
                                        <div className="w-10 h-10 bg-brand-purple rounded-2xl flex items-center justify-center text-white font-black flex-shrink-0 shadow-lg shadow-brand-purple/20">3</div>
                                        <div>
                                            <h4 className="font-black text-brand-dark uppercase text-sm tracking-wider mb-2">AI Smart Captions</h4>
                                            <p className="text-gray-500 text-sm leading-relaxed">Powered by Gemini AI, we analyze your images and craft evocative, poetic subtitles to match the vibe.</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-gray-50 p-8 rounded-[3rem] border border-gray-100 shadow-inner">
                                    <h4 className="font-black text-brand-dark uppercase text-sm tracking-wider mb-4 text-center">Important Use Case</h4>
                                    <div className="space-y-4 text-xs text-gray-500 font-medium leading-relaxed">
                                        <p><b>Muziq Slides</b> is a creative storytelling tool. It is <u>not</u> for:</p>
                                        <ul className="list-disc list-inside space-y-2">
                                            <li><b>High-Res Backup:</b> Media is compressed for cloud sync. Keep original local files.</li>
                                            <li><b>Professional Video Production:</b> Not designed for 4K broadcast-grade editing.</li>
                                            <li><b>Critical Communications:</b> Not for real-time safety or medical information.</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                </main>
            ) : (
                <main className="p-4 max-w-7xl mx-auto grid lg:grid-cols-12 gap-8 py-8">
                    <div className="lg:col-span-4 space-y-6">
                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-sm font-black uppercase mb-4 text-brand-purple tracking-widest flex items-center gap-2">
                                <span className="bg-brand-purple text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">1</span>
                                Media Library
                            </h3>
                            <div className="grid grid-cols-4 gap-2 mb-4">
                                <div className="aspect-square bg-gray-900/50 rounded-xl border-2 border-dashed border-gray-700 flex items-center justify-center relative hover:border-brand-purple transition-colors">
                                    <input type="file" multiple accept="image/*,video/*" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                    <span className="text-lg">＋</span>
                                </div>
                                {mediaFiles.map((m) => (
                                    <div key={m.id} className="aspect-square bg-gray-900 rounded-xl overflow-hidden relative border border-gray-800 group">
                                        <img src={m.previewUrl} className="w-full h-full object-cover" alt="" />
                                        <button onClick={() => setMediaFiles(p => p.filter(x => x.id !== m.id))} className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                                    </div>
                                ))}
                            </div>
                            {mediaFiles.length > 0 && (
                                <button onClick={generateSmartCaptions} disabled={isProcessingCaptions} className="w-full bg-brand-purple/10 text-brand-purple py-3 rounded-2xl text-[10px] font-black uppercase border border-brand-purple/20 flex items-center justify-center gap-2 hover:bg-brand-purple hover:text-white transition-all">
                                    {isProcessingCaptions ? 'Polishing...' : '✨ AI Smart Captions'}
                                </button>
                            )}
                        </section>

                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-sm font-black uppercase mb-4 text-brand-purple tracking-widest flex items-center gap-2">
                                <span className="bg-brand-purple text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">2</span>
                                Soundtrack
                            </h3>
                            <button onClick={() => setIsMusicBrowserOpen(true)} className="w-full bg-apple-red/10 py-3 rounded-2xl text-[10px] font-black uppercase text-apple-red border border-apple-red/30 mb-2">Music Library</button>
                            <div className="space-y-2">
                                {audioFiles.map(a => (
                                    <div key={a.id} className="bg-gray-900/40 p-2 rounded-xl text-[10px] flex justify-between items-center border border-gray-800">
                                        <span className="truncate pr-2 font-bold">{a.name}</span>
                                        <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))}>🗑️</button>
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
                                    <button key={style} onClick={() => setSettings(s => ({...s, slideStyle: style}))} className={`py-2 rounded-lg text-[10px] font-black uppercase border ${settings.slideStyle === style ? 'bg-brand-purple border-brand-purple text-white' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                                        {style.replace(/-/g, ' ')}
                                    </button>
                                ))}
                            </div>
                        </section>
                    </div>

                    <div className="lg:col-span-8 space-y-8">
                        <section className="bg-gray-800/30 p-8 rounded-[3rem] border border-gray-700/50 relative overflow-hidden">
                            <div className="flex justify-between items-center mb-6">
                                <input value={slideshowName} onChange={(e) => setSlideshowName(e.target.value)} placeholder="New Collection Title..." className="bg-transparent text-3xl font-black text-white outline-none w-full mr-4" />
                                <div className="flex gap-2">
                                    <button onClick={saveSlideshow} className="bg-gray-800 text-white px-6 py-2 rounded-full text-xs font-bold border border-gray-700 hover:bg-gray-700">Save</button>
                                    <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="bg-brand-purple text-white px-8 py-2 rounded-full text-xs font-bold shadow-2xl">Preview Fullshow</button>
                                </div>
                            </div>
                            
                            <div className="aspect-video bg-gray-950 rounded-[2.5rem] relative overflow-hidden border border-gray-800 shadow-2xl flex items-center justify-center">
                                {mediaFiles.length > 0 ? (
                                    <div className="w-full h-full relative">
                                        <img src={mediaFiles[0].previewUrl} className="w-full h-full object-cover opacity-20 blur-sm" alt="" />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="w-20 h-20 bg-brand-purple rounded-full flex items-center justify-center shadow-2xl hover:scale-105 transition-transform">
                                                <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                            </button>
                                        </div>
                                    </div>
                                ) : <p className="text-xs text-gray-700 uppercase font-black tracking-widest">Workspace Empty</p>}
                            </div>
                        </section>

                        <section>
                            <h3 className="text-xs font-black uppercase mb-4 text-gray-600 tracking-widest">Saved Collections</h3>
                            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
                                {ownedSlideshows.map(ss => (
                                    <div key={ss.id} className="bg-gray-900/40 p-5 rounded-[2rem] flex justify-between items-center group border border-gray-800 hover:border-brand-purple/50 transition-all">
                                        <div onClick={() => loadProject(ss)} className="cursor-pointer truncate pr-2">
                                            <p className="font-bold text-xs truncate">{ss.name}</p>
                                            <p className="text-[8px] text-gray-600 font-bold uppercase tracking-widest">{ss.media.length} items</p>
                                        </div>
                                        <button onClick={() => deleteSlideshow(ss.id)} className="text-gray-700 hover:text-red-500 transition-colors">🗑️</button>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </div>
                </main>
            )}

            {isMusicBrowserOpen && (
                <div className="fixed inset-0 bg-black/90 z-[500] flex items-center justify-center p-6 backdrop-blur-xl">
                    <div className="bg-gray-900 w-full max-w-lg rounded-[2.5rem] border border-gray-800 p-10">
                        <div className="flex justify-between items-center mb-10">
                            <h2 className="text-xl font-black uppercase tracking-tighter text-white">Music Selection</h2>
                            <button onClick={() => setIsMusicBrowserOpen(false)} className="text-gray-500">✕</button>
                        </div>
                        <div className="space-y-4">
                            {MOCK_TRACKS.map(track => (
                                <div key={track.id} className="bg-gray-800 p-4 rounded-2xl flex justify-between items-center hover:bg-gray-750 cursor-pointer" onClick={() => { setAudioFiles([{ ...track, startTime: 0, previewUrl: '' }]); setIsMusicBrowserOpen(false); }}>
                                    <span className="font-bold text-sm text-gray-200">{track.name}</span>
                                    <span className="text-[10px] text-gray-500">Add</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {isPlaying && (
                <div className="fixed inset-0 bg-black z-[600] flex flex-col items-center justify-center">
                    <button onClick={() => setIsPlaying(false)} className="absolute top-10 right-10 text-white/50 hover:text-white p-5 z-[610] text-2xl">✕</button>
                    <div className="w-full h-full relative overflow-hidden">
                        {mediaWithTimestamps.map((m, idx) => (
                            <TheaterMedia key={m.id} media={m} isVisible={idx === currentSlide} slideStyle={settings.slideStyle} showCaptions={settings.showCaptions} />
                        ))}
                    </div>
                    <div className="absolute bottom-0 left-0 h-1 bg-brand-purple z-[620] transition-all" style={{ width: `${(elapsedTime / totalSlideshowDuration) * 100}%` }}></div>
                </div>
            )}
            
            {error && (
                <div className="fixed bottom-6 right-6 bg-red-500 text-white p-4 rounded-2xl shadow-2xl z-[700] flex gap-4 items-center border border-white/20">
                    <p className="text-xs font-bold uppercase">{error}</p>
                    <button onClick={() => setError(null)}>✕</button>
                </div>
            )}
        </div>
    );
};

export default App;
