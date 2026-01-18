
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

// --- SUPERUSER ACCOUNTS ---
const SUPERUSERS = ['reach_dlaniger@hotmail.com', 'dlaniger.napm.consulting@gmail.com'];

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
    userEmail?: string;
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

// --- UTILITIES ---
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
    const [sharedSlideshows, setSharedSlideshows] = useState<SavedSlideshow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessingCaptions, setIsProcessingCaptions] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isMusicBrowserOpen, setIsMusicBrowserOpen] = useState(false);
    const [appleMusicAuthorized, setAppleMusicAuthorized] = useState(false);
    const [viewMode, setViewMode] = useState<'easy' | 'studio'>('easy');
    const [showPremiumModal, setShowPremiumModal] = useState(false);
    const [hasPremium, setHasPremium] = useState(false);

    const requestRef = useRef<number>(0);
    const startTimeRef = useRef<number>(0);
    const lastTickTimeRef = useRef<number>(0);

    const isSuperUser = useMemo(() => user?.email && SUPERUSERS.includes(user.email.toLowerCase()), [user]);

    const checkAccess = useCallback((featureName: string) => {
        if (isSuperUser || hasPremium) return true;
        setShowPremiumModal(true);
        return false;
    }, [isSuperUser, hasPremium]);

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
            if (u) {
                // Check Firestore for user subscription status
                const userDoc = await getDoc(doc(db, "users", u.uid));
                if (userDoc.exists()) {
                    setHasPremium(userDoc.data().premium || false);
                }
            }
            setIsLoading(false); 
        });
        return unsubscribe;
    }, []);

    // Load Collections
    useEffect(() => {
        if (!user) return;
        const qOwned = query(collection(db, "slideshows"), where("userId", "==", user.uid));
        const unsubOwned = onSnapshot(qOwned, (snap) => {
            setOwnedSlideshows(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow)));
        });

        const qShared = query(collection(db, "slideshows"), where("sharedWith", "array-contains", user.email));
        const unsubShared = onSnapshot(qShared, (snap) => {
            setSharedSlideshows(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow)));
        });

        return () => { unsubOwned(); unsubShared(); };
    }, [user]);

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
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
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
            userEmail: user.email,
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

    const shareProject = async (projectId: string) => {
        if (!checkAccess('Share & Publish')) return;
        const email = prompt("Enter Google Account email to share with:");
        if (email) {
            await updateDoc(doc(db, "slideshows", projectId), {
                sharedWith: arrayUnion(email.toLowerCase())
            });
            alert(`Shared with ${email}!`);
        }
    };

    const startTrial = async () => {
        if (!user) return;
        await setDoc(doc(db, "users", user.uid), { premium: true, trialStart: serverTimestamp() }, { merge: true });
        setHasPremium(true);
        setShowPremiumModal(false);
        alert("3-Day Trial Activated!");
    };

    const handleAuthorizeApple = async () => {
        const mk = (window as any).MusicKit?.getInstance();
        if (mk) {
            try {
                await mk.authorize();
                setAppleMusicAuthorized(mk.isAuthorized);
            } catch (e) {
                setError("Apple Music Auth failed.");
            }
        } else {
            setError("MusicKit not initialized.");
        }
    };

    const exportToPDF = () => {
        if (!checkAccess('Export to PDF')) return;
        window.print(); // Simple standard export for web apps
    };

    if (isLoading) return <div className="min-h-screen bg-brand-dark flex items-center justify-center"><div className="w-10 h-10 border-4 border-brand-purple border-t-transparent rounded-full animate-spin"></div></div>;

    return (
        <div className="min-h-screen bg-brand-dark text-gray-200">
            {/* Header */}
            <header className="p-4 flex justify-between items-center border-b border-gray-800 bg-gray-900/80 sticky top-0 z-40 backdrop-blur-xl">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-brand-purple rounded-lg flex items-center justify-center font-black text-white shadow-lg">M</div>
                    <h1 className="text-xl font-bold text-white"><span className="text-brand-purple">Muziq</span> Slides</h1>
                    {(isSuperUser || hasPremium) && <span className="ml-2 text-[8px] bg-brand-purple/20 text-brand-purple px-2 py-0.5 rounded-full font-black uppercase tracking-widest border border-brand-purple/30">Member</span>}
                </div>
                <div className="flex items-center gap-4">
                    {user && (
                        <nav className="flex bg-gray-800/50 p-1 rounded-xl border border-gray-700">
                            <button onClick={() => setViewMode('easy')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'easy' ? 'bg-brand-purple text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>Builder</button>
                            <button onClick={() => setViewMode('studio')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'studio' ? 'bg-brand-purple text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>Studio</button>
                        </nav>
                    )}
                    {user ? <button onClick={() => signOut(auth)} className="text-xs bg-gray-800 px-4 py-2 rounded-lg font-bold border border-gray-700">Logout</button> : <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="text-xs bg-brand-purple px-4 py-2 rounded-lg font-bold text-white shadow-lg">Sign In</button>}
                </div>
            </header>

            {!user ? (
                /* Landing Page Content */
                <main className="bg-white text-gray-900 min-h-screen">
                    <section className="text-center pt-32 pb-24 px-4 bg-gradient-to-b from-brand-light to-white">
                        <h2 className="text-7xl font-black mb-8 tracking-tighter text-brand-dark">Memories,<br/>In <span className="text-brand-purple underline decoration-apple-red decoration-8 underline-offset-8">Perfect Sync</span></h2>
                        <p className="text-gray-500 mb-12 max-w-xl mx-auto text-xl">The only cinematic slideshow builder perfectly synced with Apple Music.</p>
                        <div className="flex justify-center gap-4">
                            <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="bg-brand-purple text-white px-12 py-5 rounded-full font-bold shadow-2xl hover:scale-105 transition-transform text-lg">Get Started Free</button>
                        </div>
                    </section>
                    
                    <section id="about" className="py-24 px-4 border-y border-gray-100">
                        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-12">
                            <div className="space-y-6">
                                <h3 className="text-4xl font-black mb-6 text-brand-dark uppercase tracking-tighter">About Muziq Slides</h3>
                                <p className="text-gray-500 leading-relaxed">Muziq Slides transforms your static photos into living, breathing cinematic experiences. By integrating directly with Apple Music and leveraging Gemini AI, we ensure every beat matches your most cherished moments.</p>
                                
                                <h4 className="font-black text-brand-dark uppercase text-sm tracking-widest pt-4">Key Features</h4>
                                <ul className="space-y-4">
                                    <li className="flex gap-4">
                                        <div className="w-8 h-8 bg-brand-purple rounded-lg flex items-center justify-center text-white font-bold flex-shrink-0 text-xs">✓</div>
                                        <p className="text-sm font-bold text-gray-700">20-Photo Cloud Library: Compressed for speed.</p>
                                    </li>
                                    <li className="flex gap-4">
                                        <div className="w-8 h-8 bg-brand-purple rounded-lg flex items-center justify-center text-white font-bold flex-shrink-0 text-xs">✓</div>
                                        <p className="text-sm font-bold text-gray-700">Apple Music Authorization: Sync your real playlists.</p>
                                    </li>
                                    <li className="flex gap-4">
                                        <div className="w-8 h-8 bg-brand-purple rounded-lg flex items-center justify-center text-white font-bold flex-shrink-0 text-xs">✓</div>
                                        <p className="text-sm font-bold text-gray-700">Gemini AI Captions: Poetic analysis of every frame.</p>
                                    </li>
                                </ul>
                            </div>
                            <div className="bg-gray-50 p-8 rounded-[3rem] border border-gray-100 shadow-inner flex flex-col justify-between">
                                <div>
                                    <h4 className="font-black text-brand-dark uppercase text-sm mb-4">Membership Tiers</h4>
                                    <div className="space-y-4 text-xs font-medium text-gray-500">
                                        <p><b>Free Tier:</b> Standard Builder, 20 photos, 1 track, basic transitions.</p>
                                        <div className="p-4 bg-brand-purple/5 border border-brand-purple/10 rounded-2xl">
                                            <p className="text-brand-dark font-black mb-2 flex items-center gap-2">
                                                Premium * <span className="bg-brand-purple text-white text-[8px] px-1.5 py-0.5 rounded">NEW</span>
                                            </p>
                                            <p className="mb-2"><b>$11.11 / Month</b> (3-Day Trial Included)</p>
                                            <ul className="list-disc list-inside space-y-1">
                                                <li>Run Simulations *</li>
                                                <li>Predict Score *</li>
                                                <li>AI Insights & Deep Dive *</li>
                                                <li>PDF Export & Printing *</li>
                                                <li>Share & Publish Report *</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-8">
                                    <h4 className="font-black text-brand-dark uppercase text-[10px] mb-2 tracking-widest">User Guide</h4>
                                    <p className="text-[10px] text-gray-400 leading-relaxed italic">1. Sign in with Google. 2. Upload up to 20 photos. 3. Authorize Apple Music or use local files. 4. Use the "Studio" tab for multi-track timing. 5. Save to cloud and Share with friends.</p>
                                </div>
                            </div>
                        </div>
                    </section>
                </main>
            ) : (
                /* Authenticated Workspace */
                <main className="p-4 max-w-7xl mx-auto grid lg:grid-cols-12 gap-8 py-8">
                    {/* Left Panel: Builder Controls */}
                    <div className="lg:col-span-4 space-y-6">
                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-sm font-black uppercase mb-4 text-brand-purple tracking-widest flex items-center gap-2">
                                <span className="bg-brand-purple text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">1</span>
                                Media
                            </h3>
                            <div className="grid grid-cols-4 gap-2 mb-4">
                                <div className="aspect-square bg-gray-900/50 rounded-xl border-2 border-dashed border-gray-700 flex items-center justify-center relative hover:border-brand-purple transition-colors cursor-pointer group">
                                    <input type="file" multiple accept="image/*" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                    <span className="text-2xl text-gray-500">＋</span>
                                </div>
                                {mediaFiles.map((m) => (
                                    <div key={m.id} className="aspect-square bg-gray-900 rounded-xl overflow-hidden relative border border-gray-800 group">
                                        <img src={m.previewUrl} className="w-full h-full object-cover" alt="" />
                                        <button onClick={() => setMediaFiles(p => p.filter(x => x.id !== m.id))} className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                                    </div>
                                ))}
                            </div>
                            <button onClick={generateSmartCaptions} disabled={isProcessingCaptions} className="w-full bg-brand-purple/10 text-brand-purple py-3 rounded-xl text-[10px] font-black uppercase border border-brand-purple/20 hover:bg-brand-purple hover:text-white transition-all shadow-lg shadow-brand-purple/5">
                                {isProcessingCaptions ? 'Analyzing Frames...' : '✨ AI Smart Captions'}
                            </button>
                        </section>

                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-sm font-black uppercase mb-4 text-brand-purple tracking-widest flex items-center gap-2">
                                <span className="bg-brand-purple text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">2</span>
                                Soundtrack
                            </h3>
                            <div className="grid grid-cols-2 gap-2 mb-4">
                                <div className="relative">
                                    <button className="w-full bg-gray-800 border border-gray-700 py-3 rounded-xl text-[10px] font-black uppercase text-gray-400 hover:text-white transition-all">Choose Files</button>
                                    <input type="file" accept="audio/*" onChange={handleAudioUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                </div>
                                <button onClick={() => setIsMusicBrowserOpen(true)} className="w-full bg-apple-red/10 py-3 rounded-xl text-[10px] font-black uppercase text-apple-red border border-apple-red/30 hover:bg-apple-red hover:text-white transition-all">Browse Apple</button>
                            </div>
                            <div className="space-y-2 max-h-[120px] overflow-y-auto">
                                {audioFiles.map(a => (
                                    <div key={a.id} className="bg-gray-900/40 p-2 rounded-xl text-[10px] flex justify-between items-center border border-gray-800">
                                        <div className="truncate">
                                            <span className="font-bold text-gray-400 block truncate">{a.name}</span>
                                            <span className="text-[8px] text-gray-600 uppercase font-black">{a.source}</span>
                                        </div>
                                        <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))} className="text-gray-600 hover:text-red-500 transition-colors">🗑️</button>
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* ADVANCED TOOLS SECTION */}
                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-sm font-black uppercase mb-4 text-brand-purple tracking-widest">Advanced Tools</h3>
                            <div className="grid grid-cols-1 gap-2">
                                <button onClick={() => checkAccess('Run Simulation') && alert("Simulating Roku environment...")} className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase bg-gray-900 border border-gray-700 text-gray-500 hover:text-brand-purple hover:border-brand-purple transition-all text-left px-4 flex justify-between items-center group">
                                    Run Simulation * <span>🚀</span>
                                </button>
                                <button onClick={() => checkAccess('Predict Score') && alert("Predicting engagement score: 94/100")} className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase bg-gray-900 border border-gray-700 text-gray-500 hover:text-brand-purple hover:border-brand-purple transition-all text-left px-4 flex justify-between items-center group">
                                    Predict Score * <span>📊</span>
                                </button>
                                <button onClick={() => checkAccess('Printing') && window.print()} className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase bg-gray-900 border border-gray-700 text-gray-500 hover:text-brand-purple hover:border-brand-purple transition-all text-left px-4 flex justify-between items-center group">
                                    Printing * <span>🖨️</span>
                                </button>
                                <button onClick={exportToPDF} className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase bg-gray-900 border border-gray-700 text-gray-500 hover:text-brand-purple hover:border-brand-purple transition-all text-left px-4 flex justify-between items-center group">
                                    Export to PDF * <span>📄</span>
                                </button>
                            </div>
                            <div className="mt-4 pt-4 border-t border-gray-700 space-y-2">
                                <h4 className="text-[10px] font-black uppercase text-gray-500 tracking-tighter mb-2">AI Advisor</h4>
                                <button onClick={() => checkAccess('Unlock AI Insights') && alert("AI Insight: Use Ken Burns effect to increase emotional resonance by 40%.")} className="w-full py-2.5 rounded-xl text-[9px] font-black uppercase bg-brand-purple/5 text-brand-purple border border-brand-purple/20 hover:bg-brand-purple hover:text-white transition-all">Unlock AI Insights *</button>
                                <button onClick={() => checkAccess('AI Deep Dive') && alert("Analyzing tonal consistency across your 20 frames...")} className="w-full py-2.5 rounded-xl text-[9px] font-black uppercase bg-brand-purple/5 text-brand-purple border border-brand-purple/20 hover:bg-brand-purple hover:text-white transition-all">AI Deep Dive *</button>
                            </div>
                        </section>
                    </div>

                    {/* Right Panel: Preview & Collections */}
                    <div className="lg:col-span-8 space-y-8">
                        <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-gray-700/50">
                            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                                <input value={slideshowName} onChange={(e) => setSlideshowName(e.target.value)} placeholder="Name Your Masterpiece..." className="bg-transparent text-4xl font-black text-white outline-none w-full placeholder:text-gray-800 tracking-tighter" />
                                <div className="flex gap-2">
                                    <button onClick={saveSlideshow} className="bg-gray-800 hover:bg-gray-700 text-white px-8 py-3 rounded-full text-xs font-bold border border-gray-700 transition-all">Save</button>
                                    <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="bg-brand-purple text-white px-10 py-3 rounded-full text-xs font-bold shadow-2xl hover:scale-105 active:scale-95 transition-all">Preview show</button>
                                </div>
                            </div>
                            
                            <div className="aspect-video bg-gray-950 rounded-[3rem] relative overflow-hidden border border-gray-800 shadow-2xl flex items-center justify-center group">
                                {mediaFiles.length > 0 ? (
                                    <div className="w-full h-full relative">
                                        <img src={mediaFiles[0].previewUrl} className="w-full h-full object-cover opacity-20 blur-sm scale-110 group-hover:scale-100 transition-transform duration-1000" alt="" />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="w-24 h-24 bg-brand-purple rounded-full flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-transform">
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

                            {/* Studio Timeline integration for multiple tracks */}
                            {viewMode === 'studio' && (
                                <div className="mt-8 p-6 bg-gray-900/50 rounded-3xl border border-gray-700/30 animate-fade-in overflow-hidden">
                                    <h4 className="text-[10px] font-black uppercase text-gray-500 tracking-widest mb-6">Multi-Track Studio Timeline</h4>
                                    <div className="space-y-4 overflow-x-auto pb-4 custom-scrollbar">
                                        {/* Visuals track */}
                                        <div className="flex h-14 bg-gray-800 rounded-xl items-center px-4 gap-1 border border-gray-700/50 min-w-max relative group">
                                            <span className="absolute -top-3 left-2 text-[8px] font-black text-gray-600 uppercase">Visual Layer</span>
                                            {mediaWithTimestamps.map(m => (
                                                <div key={m.id} className="h-10 bg-gray-700 rounded-lg border border-gray-600 flex-shrink-0 relative overflow-hidden" style={{ width: `${(m.timelineEnd! - m.timelineStart!) * 15}px` }}>
                                                    <img src={m.previewUrl} className="w-full h-full object-cover opacity-30" alt="" />
                                                </div>
                                            ))}
                                        </div>
                                        {/* Audio track slots */}
                                        <div className="space-y-2">
                                            {audioFiles.map((a, i) => (
                                                <div key={a.id} className="h-12 bg-apple-red/10 border border-apple-red/20 rounded-xl flex items-center px-4 gap-4 min-w-max relative group">
                                                    <span className="text-[9px] font-black text-apple-red uppercase mr-2 shrink-0">Track {i+1}</span>
                                                    <div className="h-8 bg-apple-red/20 rounded-lg border border-apple-red/40 flex items-center px-4 shadow-sm" style={{ width: `${a.duration * 10}px`, marginLeft: `${a.startTime * 10}px` }}>
                                                        <span className="text-[10px] font-bold text-white truncate max-w-[200px]">{a.name}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity sticky right-4 bg-gray-900 p-2 rounded-lg">
                                                        <label className="text-[8px] uppercase text-gray-500 font-bold">Delay:</label>
                                                        <input type="number" value={a.startTime} onChange={(e) => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, startTime: parseInt(e.target.value) || 0} : x))} className="w-12 bg-gray-800 text-white text-[10px] rounded px-1 py-0.5 outline-none border border-gray-700" />
                                                    </div>
                                                </div>
                                            ))}
                                            {audioFiles.length === 0 && <p className="text-center py-6 text-[9px] text-gray-700 uppercase font-black italic tracking-widest">No soundtrack tracks loaded.</p>}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </section>

                        {/* Collections Grid with Load & Share functionality */}
                        <section className="space-y-6">
                            <div className="flex justify-between items-center">
                                <h3 className="text-xs font-black uppercase text-gray-500 tracking-widest">Saved Collections</h3>
                                <div className="h-px bg-gray-800 flex-1 mx-6"></div>
                            </div>
                            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
                                {[...ownedSlideshows, ...sharedSlideshows].map(ss => (
                                    <div key={ss.id} className="bg-gray-800/20 p-6 rounded-[2.5rem] flex flex-col group border border-gray-800 hover:border-brand-purple/40 transition-all hover:bg-gray-800/30 relative">
                                        <div className="aspect-square bg-gray-900 rounded-[2rem] mb-5 overflow-hidden relative border border-gray-800/50 shadow-inner">
                                            {ss.media[0] && <img src={ss.media[0].previewUrl || `data:image/jpeg;base64,${ss.media[0].base64}`} className="w-full h-full object-cover opacity-40 group-hover:scale-105 transition-transform" alt="" />}
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-sm">
                                                <button onClick={() => loadProject(ss)} className="bg-white text-brand-dark px-6 py-2.5 rounded-full font-bold text-xs shadow-2xl hover:scale-105 active:scale-95 transition-all">Load Project</button>
                                            </div>
                                            {ss.userId !== user.uid && <div className="absolute top-4 left-4 bg-brand-purple text-white text-[8px] font-black uppercase px-2 py-1 rounded-full shadow-lg">Shared</div>}
                                        </div>
                                        <h4 className="font-bold truncate text-sm text-gray-200">{ss.name}</h4>
                                        <p className="text-[9px] text-gray-600 font-bold uppercase tracking-widest mt-1 mb-4 flex justify-between">
                                            <span>{ss.media.length} Slides</span>
                                            <span>{ss.userId === user.uid ? 'Yours' : ss.userEmail}</span>
                                        </p>
                                        <div className="flex gap-2">
                                            <button onClick={() => loadProject(ss)} className="flex-1 bg-brand-purple/10 text-brand-purple py-2.5 rounded-2xl text-[10px] font-black uppercase hover:bg-brand-purple hover:text-white transition-all">Load</button>
                                            <button onClick={() => shareProject(ss.id)} className="flex-1 bg-gray-800 text-gray-400 py-2.5 rounded-2xl text-[10px] font-black uppercase hover:text-brand-purple transition-all border border-gray-700">Share *</button>
                                            {(ss.userId === user.uid || isSuperUser) && (
                                                <button onClick={() => deleteSlideshow(ss.id)} className="px-4 bg-red-500/10 text-red-500 py-2.5 rounded-2xl text-[10px] font-black hover:bg-red-500 hover:text-white transition-all">🗑️</button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {ownedSlideshows.length === 0 && sharedSlideshows.length === 0 && (
                                    <div className="col-span-full py-16 bg-gray-900/30 rounded-[3rem] border border-dashed border-gray-800 text-center opacity-40">
                                        <p className="text-[10px] font-black uppercase tracking-[0.3em]">Cloud Library is Empty</p>
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>
                </main>
            )}

            {/* Apple Music Authorization Modal */}
            {isMusicBrowserOpen && (
                <div className="fixed inset-0 bg-black/95 z-[500] flex items-center justify-center p-6 backdrop-blur-3xl animate-fade-in">
                    <div className="bg-gray-950 w-full max-w-2xl h-[80vh] rounded-[4rem] border border-gray-800 p-12 flex flex-col shadow-[0_0_100px_rgba(250,36,60,0.15)] relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-apple-red to-transparent opacity-30"></div>
                        <div className="flex justify-between items-center mb-12">
                            <div>
                                <h2 className="text-3xl font-black uppercase tracking-tighter text-white">Music Collection</h2>
                                <p className="text-[10px] text-apple-red font-black uppercase tracking-[0.2em] mt-2">Authenticated Apple Music Access</p>
                            </div>
                            <button onClick={() => setIsMusicBrowserOpen(false)} className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center text-gray-500 hover:text-white transition-all shadow-xl">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
                            {!appleMusicAuthorized ? (
                                <div className="text-center py-24 bg-gray-900/50 rounded-[3rem] border border-gray-800 group hover:border-apple-red/30 transition-all duration-700">
                                    <div className="w-20 h-20 bg-apple-red/20 text-apple-red rounded-[2.5rem] flex items-center justify-center mx-auto mb-8 text-3xl shadow-2xl group-hover:scale-110 transition-transform"></div>
                                    <h3 className="text-xl font-bold mb-4 text-white">Apple Music Library</h3>
                                    <p className="text-xs text-gray-500 mb-12 max-w-xs mx-auto leading-relaxed">Connect your official subscription to browse your real library, playlists, and recently played tracks.</p>
                                    <button onClick={handleAuthorizeApple} className="bg-apple-red text-white px-12 py-5 rounded-full font-bold shadow-2xl shadow-apple-red/30 hover:scale-105 active:scale-95 transition-all text-sm uppercase tracking-widest">Authorize Access</button>
                                    <p className="mt-8 text-[9px] text-gray-700 font-black uppercase tracking-widest">Requires Apple Music Subscription</p>
                                </div>
                            ) : (
                                <div className="grid gap-4">
                                    <p className="text-[10px] font-black uppercase text-gray-500 tracking-[0.2em] mb-4">Curated Simulation Tracks</p>
                                    {MOCK_TRACKS.map(track => (
                                        <div key={track.id} className="bg-gray-900/60 p-6 rounded-[2.5rem] border border-gray-800 flex justify-between items-center hover:border-brand-purple group cursor-pointer transition-all hover:bg-gray-900 shadow-sm" onClick={() => { setAudioFiles(p => [...p, {...track, startTime: 0, previewUrl: ''}]); setIsMusicBrowserOpen(false); }}>
                                            <div className="flex items-center gap-5">
                                                <div className="w-14 h-14 bg-gray-800 rounded-2xl flex items-center justify-center text-2xl shadow-inner group-hover:scale-105 transition-transform">🎵</div>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-gray-100 text-sm">{track.name}</span>
                                                    <span className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">3:04 • Master Grade</span>
                                                </div>
                                            </div>
                                            <button className="bg-brand-purple/10 text-brand-purple px-8 py-3 rounded-2xl text-[10px] font-black uppercase group-hover:bg-brand-purple group-hover:text-white transition-all shadow-md">Add to Timeline</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Premium Membership Modal */}
            {showPremiumModal && (
                <div className="fixed inset-0 bg-black/80 z-[1000] flex items-center justify-center p-6 backdrop-blur-xl animate-fade-in">
                    <div className="bg-white text-brand-dark w-full max-w-md rounded-[4rem] p-14 text-center shadow-[0_0_100px_rgba(109,40,217,0.3)] relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-brand-purple/5 rounded-full -translate-y-16 translate-x-16"></div>
                        <div className="w-24 h-24 bg-brand-purple rounded-[2.5rem] flex items-center justify-center mx-auto mb-10 text-4xl text-white shadow-2xl shadow-brand-purple/30">✨</div>
                        <h2 className="text-4xl font-black uppercase tracking-tighter mb-4 leading-none">Elevate Your Storytelling</h2>
                        <p className="text-gray-500 text-sm mb-12 leading-relaxed px-4">Unlock pro-grade simulations, deep AI analysis, and advanced export features.</p>
                        
                        <div className="bg-gray-50 p-8 rounded-[3rem] mb-12 border border-gray-100">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">Member Special</p>
                            <p className="text-4xl font-black text-brand-purple">$11.11 <span className="text-xs text-gray-400 font-bold">/ MONTH</span></p>
                            <p className="text-[11px] font-bold text-brand-purple/60 mt-4 px-6 bg-brand-purple/5 py-2 rounded-full inline-block">Includes 3-Day Free Trial</p>
                        </div>
                        
                        <div className="flex flex-col gap-5">
                            <button onClick={startTrial} className="bg-brand-purple text-white py-5 rounded-full font-black shadow-2xl hover:scale-105 active:scale-95 transition-all uppercase tracking-widest text-xs">Start 3-Day Free Trial</button>
                            <button onClick={() => setShowPremiumModal(false)} className="text-[11px] font-black text-gray-400 uppercase hover:text-brand-dark tracking-widest transition-colors py-2">Return to Free Editor</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Global Error Banner */}
            {error && (
                <div className="fixed bottom-10 right-10 bg-red-600 text-white p-6 rounded-[2.5rem] shadow-[0_20px_60px_rgba(220,38,38,0.5)] z-[2000] flex gap-8 items-center border border-white/20 animate-slide-from-bottom">
                    <div className="flex flex-col">
                        <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-1">System Error</p>
                        <p className="text-sm font-bold">{error}</p>
                    </div>
                    <button onClick={() => setError(null)} className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center font-black transition-all">✕</button>
                </div>
            )}

            {/* Fullscreen Player Layer */}
            {isPlaying && (
                <div className="fixed inset-0 bg-black z-[5000] flex flex-col items-center justify-center cursor-none animate-fade-in group/player">
                    <button onClick={() => setIsPlaying(false)} className="absolute top-10 right-10 text-white/30 hover:text-white p-6 z-[5010] text-4xl transition-all cursor-pointer bg-white/5 hover:bg-white/10 rounded-full opacity-0 group-hover/player:opacity-100">✕</button>
                    <div className="w-full h-full relative overflow-hidden flex items-center justify-center">
                        {mediaWithTimestamps.map((m, idx) => (
                            <TheaterMedia key={m.id} media={m} isVisible={idx === currentSlide} slideStyle={settings.slideStyle} showCaptions={settings.showCaptions} />
                        ))}
                    </div>
                    {/* Synchronized Audio */}
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
                                            // Real-time offset correction
                                            const targetTime = elapsedTime - a.startTime;
                                            if (Math.abs(el.currentTime - targetTime) > 0.5) el.currentTime = targetTime;
                                        } else {
                                            if (!el.paused) el.pause();
                                        }
                                    }
                                }}
                            />
                        ) : null;
                    })}
                    <div className="absolute bottom-0 left-0 h-1.5 bg-brand-purple z-[5020] transition-all duration-200 shadow-[0_0_30px_rgba(109,40,217,0.8)]" style={{ width: `${(elapsedTime / totalSlideshowDuration) * 100}%` }}></div>
                </div>
            )}
        </div>
    );
};

export default App;
