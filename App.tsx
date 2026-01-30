
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

// --- IMAGE COMPRESSION ---
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
            resolve(canvas.toDataURL('image/jpeg', 0.5).split(',')[1]);
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
  isMuted?: boolean;
  videoVolume?: number; 
}

interface AppStateAudio {
    id: string;
    name: string;
    duration: number; 
    originalDuration?: number;
    startTime: number; 
    previewUrl: string; 
    source: 'local' | 'apple-music' | 'sfx';
    fadeIn?: boolean;
    fadeOut?: boolean;
    volume?: number;
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

const SFX_OPTIONS = [
    { name: 'Boom', url: 'https://actions.google.com/sounds/v1/science_fiction/low_boom.ogg' },
    { name: 'Stream Water', url: 'https://actions.google.com/sounds/v1/water/creek_flowing.ogg' },
    { name: 'Ocean Beach', url: 'https://actions.google.com/sounds/v1/water/waves_crashing_on_rock.ogg' },
    { name: 'Airplane', url: 'https://actions.google.com/sounds/v1/transportation/airplane_interior_hum.ogg' },
    { name: 'Traffic', url: 'https://actions.google.com/sounds/v1/transportation/city_traffic_ambience.ogg' },
    { name: 'Thunderstorm', url: 'https://actions.google.com/sounds/v1/weather/thunder_and_rain.ogg' },
    { name: 'Birds', url: 'https://actions.google.com/sounds/v1/animals/bird_whistling.ogg' },
    { name: 'Camera Click', url: 'https://actions.google.com/sounds/v1/tools/camera_shutter_click.ogg' },
    { name: 'Magical', url: 'https://actions.google.com/sounds/v1/science_fiction/magic_chime.ogg' },
    { name: 'Film Projector', url: 'https://actions.google.com/sounds/v1/tools/old_film_projector.ogg' },
];

const MOCK_TRACKS: AppStateAudio[] = [
    { id: 'm1', name: 'Midnight City', duration: 243, originalDuration: 243, startTime: 0, previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', source: 'apple-music', volume: 0.8 },
    { id: 'm2', name: 'Starboy', duration: 230, originalDuration: 230, startTime: 0, previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', source: 'apple-music', volume: 0.8 },
    { id: 'm3', name: 'Blinding Lights', duration: 200, originalDuration: 200, startTime: 0, previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', source: 'apple-music', volume: 0.8 },
    { id: 'm4', name: 'Levitating', duration: 203, originalDuration: 203, startTime: 0, previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3', source: 'apple-music', volume: 0.8 },
    { id: 'm5', name: 'Save Your Tears', duration: 215, originalDuration: 215, startTime: 0, previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3', source: 'apple-music', volume: 0.8 },
];

const TheaterMedia: React.FC<{
    media: MediaFile;
    isVisible: boolean;
    slideStyle: string;
    showCaptions: boolean;
    globalVisualsMuted: boolean;
}> = ({ media, isVisible, slideStyle, showCaptions, globalVisualsMuted }) => {
    const animationClass = isVisible ? `animate-${slideStyle}` : 'opacity-0 pointer-events-none';
    const mediaUrl = (media.base64 && (!media.previewUrl || media.previewUrl === '')) 
        ? `data:image/jpeg;base64,${media.base64}` 
        : media.previewUrl;

    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (videoRef.current) {
            const individualMute = media.isMuted;
            videoRef.current.volume = (globalVisualsMuted || individualMute) ? 0 : (media.videoVolume ?? 1);
            videoRef.current.muted = globalVisualsMuted || individualMute;
        }
    }, [media.isMuted, media.videoVolume, isVisible, globalVisualsMuted]);

    return (
        <div className={`w-full h-full absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-700 ${isVisible ? 'opacity-100 z-20' : 'opacity-0 z-10'}`}>
            <div key={`${media.id}-${isVisible}`} className={`w-full h-full flex items-center justify-center ${animationClass}`}>
                {media.type === 'image' ? (
                    <img src={mediaUrl} className="w-full h-full object-contain" alt="slide" />
                ) : (
                    <video ref={videoRef} src={mediaUrl} className="w-full h-full object-contain" autoPlay muted={globalVisualsMuted || media.isMuted} loop playsInline />
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
    const [trackMutes, setTrackMutes] = useState({
        visuals: false,
        music: false,
        sfx: false
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
    const [viewMode, setViewMode] = useState<'easy' | 'studio'>('easy');
    const [isSimulationMode, setIsSimulationMode] = useState(false);
    
    const requestRef = useRef<number>(0);
    const startTimeRef = useRef<number>(0);
    const lastTickTimeRef = useRef<number>(0);
    const audioPoolRef = useRef<Map<string, HTMLAudioElement>>(new Map());

    const reconstructMedia = useCallback((media: MediaFile[]) => {
        return (media || []).map(m => {
            const isMuted = m.isMuted ?? (m.type === 'video');
            const videoVolume = m.videoVolume ?? 1;
            const caption = m.caption ?? '';
            const previewUrl = (m.base64 && (!m.previewUrl || m.previewUrl === '' || m.previewUrl.startsWith('blob:')))
                ? `data:image/jpeg;base64,${m.base64}`
                : m.previewUrl;
            return { ...m, isMuted, videoVolume, caption, previewUrl };
        });
    }, []);

    const reconstructAudio = useCallback((audioList: AppStateAudio[]) => {
        return (audioList || []).map(a => {
            let fixedUrl = a.previewUrl;
            if (!fixedUrl || fixedUrl === '') {
                if (a.source === 'sfx') {
                    const foundSfx = SFX_OPTIONS.find(s => s.name === a.name);
                    if (foundSfx) fixedUrl = foundSfx.url;
                } else if (a.source === 'apple-music') {
                    const foundMock = MOCK_TRACKS.find(m => m.name === a.name);
                    if (foundMock) fixedUrl = foundMock.previewUrl;
                }
            }
            return { 
                ...a, 
                previewUrl: fixedUrl, 
                volume: a.volume ?? 0.8,
                fadeIn: a.fadeIn ?? false,
                fadeOut: a.fadeOut ?? false
            };
        });
    }, []);

    const loadProject = useCallback((project: SavedSlideshow) => {
        if (!project) return;
        const restoredMedia = reconstructMedia(project.media);
        const restoredAudio = reconstructAudio(project.audio);
        setCurrentProjectId(project.id || null);
        setMediaFiles(restoredMedia);
        setAudioFiles(restoredAudio);
        setSettings(project.settings || { interval: 5, slideStyle: 'ken-burns', repeatSlideshow: false, showCaptions: true });
        setSlideshowName(project.name || '');
        setElapsedTime(0);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [reconstructMedia, reconstructAudio]);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => { 
            setUser(u); 
            setIsLoading(false); 
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        if (!user) { setOwnedSlideshows([]); return; }
        const qOwned = query(collection(db, "slideshows"), where("userId", "==", user.uid));
        const unsubOwned = onSnapshot(qOwned, (snap) => {
            const projects = snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow));
            setOwnedSlideshows(projects.map(p => ({...p, media: reconstructMedia(p.media)})));
        });
        return unsubOwned;
    }, [user, reconstructMedia]);

    useEffect(() => {
        if (isPlaying) {
            audioFiles.forEach(track => {
                if (!track.previewUrl) return; 
                let audio = audioPoolRef.current.get(track.id);
                if (!audio) {
                    audio = new Audio(track.previewUrl);
                    audio.crossOrigin = "anonymous";
                    audioPoolRef.current.set(track.id, audio);
                }
                if (audio) {
                    const relativeTime = elapsedTime - track.startTime;
                    if (relativeTime >= 0 && relativeTime < track.duration) {
                        if (audio.paused) {
                            audio.currentTime = relativeTime;
                            audio.play().catch(e => console.warn("Audio play blocked:", e));
                        }
                        const isGlobalMuted = track.source === 'sfx' ? trackMutes.sfx : trackMutes.music;
                        let targetVolume = isGlobalMuted ? 0 : ((track.volume !== undefined) ? track.volume : 0.8);
                        if (track.fadeIn && relativeTime < 2) targetVolume *= (relativeTime / 2);
                        if (track.fadeOut && relativeTime > track.duration - 2) targetVolume *= ((track.duration - relativeTime) / 2);
                        audio.volume = Math.max(0, Math.min(1, targetVolume));
                        audio.muted = isGlobalMuted;
                    } else if (!audio.paused) {
                        audio.pause();
                        audio.currentTime = 0;
                    }
                }
            });
        } else {
            audioPoolRef.current.forEach(audio => { audio.pause(); audio.currentTime = 0; });
        }
    }, [isPlaying, elapsedTime, audioFiles, trackMutes]);

    const mediaWithTimestamps = useMemo(() => {
        let currentPos = 0;
        return mediaFiles.map(m => {
            const start = currentPos;
            const dur = m.type === 'image' ? settings.interval : (m.duration || settings.interval);
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
        if (delta > 0.5) { requestRef.current = requestAnimationFrame(animate); return; }
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
        const existingCount = mediaFiles.length;
        const files: File[] = Array.from(e.target.files).slice(0, 20 - existingCount) as File[];
        if (files.length === 0) return;
        const newMedia: MediaFile[] = await Promise.all(files.map(async (f: File) => {
            const previewUrl = URL.createObjectURL(f);
            let base64 = '';
            let duration = 5;
            if (f.type.startsWith('image')) {
                const reader = new FileReader();
                const rawBase64: string = await new Promise((resolve) => {
                    reader.onload = () => resolve((reader.result as string).split(',')[1]);
                    reader.readAsDataURL(f);
                });
                base64 = await compressImage(rawBase64);
            } else if (f.type.startsWith('video')) {
                const vid = document.createElement('video');
                vid.src = previewUrl;
                duration = await new Promise((resolve) => {
                    vid.onloadedmetadata = () => resolve(vid.duration);
                });
            }
            return {
                id: Math.random().toString(36).substr(2, 9),
                type: f.type.startsWith('image') ? 'image' : 'video',
                previewUrl: f.type.startsWith('image') ? `data:image/jpeg;base64,${base64}` : previewUrl,
                caption: '',
                base64: base64 || '',
                isMuted: f.type.startsWith('video'),
                duration: duration,
                videoVolume: 1
            };
        }));
        setMediaFiles(p => [...p, ...newMedia]);
    };

    const addSFX = (sfx: {name: string, url: string}) => {
        const trackId = Math.random().toString(36).substr(2, 9);
        setAudioFiles(p => [...p, { id: trackId, name: sfx.name, duration: 2, originalDuration: 2, startTime: elapsedTime, previewUrl: sfx.url, source: 'sfx', volume: 0.8 }]);
        const audioLoader = new Audio(sfx.url);
        audioLoader.onloadedmetadata = () => {
            setAudioFiles(p => p.map(a => a.id === trackId ? { ...a, duration: audioLoader.duration, originalDuration: audioLoader.duration } : a));
        };
    };

    const saveSlideshow = async () => {
        if (!user || mediaFiles.length === 0) { setError("Add content first."); return; }
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
                alert("Slideshow saved to cloud!"); 
            }
        } catch (e: any) { setError("Save Error: " + e.message); }
    };

    const handleGoogleLogin = async () => {
        const provider = new GoogleAuthProvider();
        try { await signInWithPopup(auth, provider); } catch (e: any) { setError("Login failed: " + e.message); }
    };

    const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

    if (isLoading) return <div className="min-h-screen bg-brand-dark flex items-center justify-center"><div className="w-10 h-10 border-4 border-brand-purple border-t-transparent rounded-full animate-spin"></div></div>;

    return (
        <div className="min-h-screen bg-brand-dark text-gray-200 selection:bg-brand-purple selection:text-white">
            <header className="fixed top-0 inset-x-0 p-4 flex justify-between items-center z-[100] bg-gray-900/40 backdrop-blur-2xl border-b border-white/5">
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})}>
                    <div className="w-8 h-8 bg-brand-purple rounded-lg flex items-center justify-center font-black text-white shadow-lg shadow-brand-purple/20">M</div>
                    <h1 className="text-xl font-bold tracking-tight text-white uppercase"><span className="text-brand-purple">Muziq</span> Slides</h1>
                </div>
                {user && (
                    <nav className="hidden md:flex items-center gap-8">
                        <button onClick={() => setViewMode('easy')} className={`text-xs font-black uppercase tracking-widest ${viewMode === 'easy' ? 'text-brand-purple' : 'text-gray-400 hover:text-white'}`}>Builder</button>
                        <button onClick={() => setViewMode('studio')} className={`text-xs font-black uppercase tracking-widest ${viewMode === 'studio' ? 'text-brand-purple' : 'text-gray-400 hover:text-white'}`}>Studio</button>
                    </nav>
                )}
                <div className="flex items-center gap-4">
                    {user ? <button onClick={() => signOut(auth)} className="text-xs bg-white/10 px-4 py-2 rounded-lg font-bold border border-white/5 transition-colors">Logout</button> : <button onClick={handleGoogleLogin} className="text-xs bg-brand-purple px-6 py-2.5 rounded-full font-black uppercase text-white shadow-2xl">Sign In</button>}
                </div>
            </header>

            {!user ? (
                <main className="animate-fade-in pt-20">
                    <section className="min-h-screen flex flex-col items-center justify-center text-center px-4 bg-gradient-to-b from-brand-dark to-gray-950">
                        <div className="space-y-4 mb-12">
                            <h2 className="text-7xl md:text-[9rem] font-black tracking-tighter text-white leading-none">Muziq Slides</h2>
                            <p className="text-xl md:text-2xl font-bold text-brand-purple tracking-widest uppercase opacity-80">Cinematic Memory Collections</p>
                        </div>
                        <button onClick={handleGoogleLogin} className="bg-white text-brand-dark px-12 py-5 rounded-full font-black uppercase tracking-widest text-sm shadow-2xl hover:scale-105 transition-transform">Get Started Free</button>
                    </section>
                    
                    <section id="features" className="py-32 px-8 max-w-7xl mx-auto grid md:grid-cols-2 gap-16 items-center border-t border-white/5">
                        <div className="space-y-8">
                            <span className="text-brand-purple font-black uppercase tracking-[0.3em] text-xs">Features</span>
                            <h3 className="text-5xl md:text-7xl font-black tracking-tighter text-white">The Cinematic Canvas.</h3>
                            <p className="text-xl text-gray-400 leading-relaxed">Upload up to 20 media files. Choose from motion styles like Ken Burns, Slide, and Fade to bring your stories to life.</p>
                        </div>
                        <div className="bg-gray-800/20 aspect-video rounded-[3rem] border border-white/5 flex items-center justify-center relative group overflow-hidden">
                             <div className="absolute inset-0 bg-brand-purple/5 group-hover:bg-brand-purple/10 transition-colors"></div>
                             <div className="grid grid-cols-4 gap-4 p-12 w-full h-full opacity-30">
                                {[...Array(12)].map((_, i) => <div key={i} className="bg-gray-700 rounded-xl"></div>)}
                             </div>
                        </div>
                    </section>

                    <section className="py-32 bg-white/[0.02] border-y border-white/5 px-8">
                        <div className="max-w-7xl mx-auto flex flex-col md:flex-row-reverse items-center gap-16">
                            <div className="md:w-1/2 space-y-8">
                                <span className="text-apple-red font-black uppercase tracking-[0.3em] text-xs">Harmony</span>
                                <h3 className="text-5xl md:text-7xl font-black tracking-tighter text-white">Apple Music Sync.</h3>
                                <p className="text-xl text-gray-400 leading-relaxed">Integration for Apple Music. Pair your collection with the perfect soundtrack from your library or our curated tracks.</p>
                            </div>
                            <div className="md:w-1/2 flex justify-center text-[12rem] text-apple-red opacity-10 drop-shadow-2xl"></div>
                        </div>
                    </section>

                    <footer className="py-32 px-8 bg-gray-950 text-center">
                        <div className="max-w-md mx-auto space-y-8 opacity-40">
                             <div className="text-2xl font-black uppercase tracking-widest">Muziq Slides</div>
                             <p className="text-sm">Created for cinematic memory sharing. Powered by Gemini.</p>
                        </div>
                    </footer>
                </main>
            ) : (
                <main className="p-4 max-w-7xl mx-auto pt-28 animate-fade-in">
                    <div className="flex flex-col md:flex-row justify-between items-center mb-12 gap-6">
                        <input value={slideshowName} onChange={(e) => setSlideshowName(e.target.value)} placeholder="Untitled Project" className="bg-transparent text-5xl md:text-7xl font-black text-white/90 outline-none w-full placeholder:text-white/10 tracking-tighter" />
                        <div className="flex flex-wrap gap-4">
                            <button onClick={saveSlideshow} className="bg-white/5 hover:bg-white/10 px-8 py-3 rounded-full text-xs font-bold border border-white/10 transition-colors">Save</button>
                            <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="bg-brand-purple text-white px-10 py-3 rounded-full text-xs font-bold shadow-2xl hover:scale-105 transition-transform">Preview Collection</button>
                        </div>
                    </div>

                    {viewMode === 'studio' ? (
                        <div className="space-y-8 animate-fade-in">
                            <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-white/5 shadow-2xl">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-xs font-black uppercase text-brand-purple tracking-widest">Multi-Track Editor</h3>
                                    <div className="flex items-center gap-4">
                                        <button onClick={() => setIsPlaying(!isPlaying)} className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isPlaying ? 'bg-brand-purple text-white' : 'bg-white/10 text-white'}`}>
                                            {isPlaying ? <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> : <svg className="w-4 h-4 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}
                                        </button>
                                        <span className="text-[10px] font-black text-gray-500">{elapsedTime.toFixed(1)}s / {totalSlideshowDuration.toFixed(1)}s</span>
                                    </div>
                                </div>
                                
                                <div className="bg-gray-900 rounded-[2rem] border border-white/5 p-8 space-y-4 overflow-x-auto relative">
                                    {/* TRACKS MUTES & LABELS */}
                                    <div className="flex items-center gap-4 min-w-[1000px]">
                                        <div className="w-32 flex flex-col gap-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-black text-gray-500">VISUALS</span>
                                                <button onClick={() => setTrackMutes(m => ({...m, visuals: !m.visuals}))} className={trackMutes.visuals ? 'text-red-500' : 'text-gray-600'}>M</button>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-black text-gray-500">MUSIC</span>
                                                <button onClick={() => setTrackMutes(m => ({...m, music: !m.music}))} className={trackMutes.music ? 'text-red-500' : 'text-gray-600'}>M</button>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-black text-gray-500">SFX</span>
                                                <button onClick={() => setTrackMutes(m => ({...m, sfx: !m.sfx}))} className={trackMutes.sfx ? 'text-red-500' : 'text-gray-600'}>M</button>
                                            </div>
                                        </div>
                                        <div className="flex-1 relative h-24 border border-white/5 rounded-xl bg-black/20">
                                            <div className="absolute top-0 bottom-0 w-0.5 bg-brand-purple z-10 transition-all" style={{left: `${(elapsedTime / Math.max(totalSlideshowDuration, 60)) * 100}%`}}></div>
                                            <div className="flex h-1/3">
                                                {mediaWithTimestamps.map(m => <div key={m.id} className="h-full border-r border-white/10 bg-white/5 flex items-center justify-center text-[8px]" style={{width: `${((m.timelineEnd! - m.timelineStart!) / Math.max(totalSlideshowDuration, 60)) * 100}%`}}>🖼️</div>)}
                                            </div>
                                            <div className="flex h-1/3">
                                                {audioFiles.filter(a => a.source !== 'sfx').map(a => <div key={a.id} className="h-full bg-brand-purple/20 border-r border-white/10 text-[8px] flex items-center px-1 truncate" style={{marginLeft: `${(a.startTime / Math.max(totalSlideshowDuration, 60)) * 100}%`, width: `${(a.duration / Math.max(totalSlideshowDuration, 60)) * 100}%`}}>🎵 {a.name}</div>)}
                                            </div>
                                            <div className="flex h-1/3">
                                                {audioFiles.filter(a => a.source === 'sfx').map(a => <div key={a.id} className="h-full bg-apple-red/20 border-r border-white/10 text-[8px] flex items-center px-1 truncate" style={{marginLeft: `${(a.startTime / Math.max(totalSlideshowDuration, 60)) * 100}%`, width: `${(a.duration / Math.max(totalSlideshowDuration, 60)) * 100}%`}}>💥 {a.name}</div>)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <div className="grid md:grid-cols-2 gap-8">
                                <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-white/5">
                                    <h3 className="text-xs font-black uppercase mb-6 text-brand-purple tracking-widest">Sound Effects</h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        {SFX_OPTIONS.map(sfx => (
                                            <button key={sfx.name} onClick={() => addSFX(sfx)} className="bg-gray-900/60 p-4 rounded-2xl text-[10px] font-black uppercase border border-white/5 hover:border-brand-purple transition-all flex justify-between group active:scale-95">
                                                {sfx.name} <span className="opacity-0 group-hover:opacity-100 text-brand-purple">＋ Add</span>
                                            </button>
                                        ))}
                                    </div>
                                </section>
                                <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-white/5">
                                    <h3 className="text-xs font-black uppercase mb-6 text-brand-purple tracking-widest">Saved Projects</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        {ownedSlideshows.map(ss => (
                                            <div key={ss.id} className="bg-gray-950 p-4 rounded-3xl border border-white/5 flex flex-col gap-2 hover:border-brand-purple transition-all cursor-pointer group" onClick={() => loadProject(ss)}>
                                                <div className="aspect-square bg-gray-900 rounded-2xl overflow-hidden">
                                                    {ss.media[0] && <img src={ss.media[0].previewUrl} className="w-full h-full object-cover opacity-50" />}
                                                </div>
                                                <div className="text-[10px] font-bold truncate">{ss.name}</div>
                                                <div className="flex gap-2">
                                                    <button onClick={(e) => { e.stopPropagation(); loadProject(ss); }} className="text-[8px] bg-brand-purple/20 px-2 py-1 rounded-full text-brand-purple">EDIT</button>
                                                    <button onClick={(e) => { e.stopPropagation(); deleteDoc(doc(db, "slideshows", ss.id)); }} className="text-[8px] text-gray-600">DELETE</button>
                                                </div>
                                            </div>
                                        ))}
                                        {ownedSlideshows.length === 0 && <div className="col-span-2 py-12 text-center opacity-20 text-[10px] font-black uppercase">No Collections Found</div>}
                                    </div>
                                </section>
                            </div>
                        </div>
                    ) : (
                        <div className="grid md:grid-cols-12 gap-8 animate-fade-in">
                            <div className="md:col-span-4 space-y-6">
                                <section className="bg-gray-800/30 p-6 rounded-3xl border border-white/5 shadow-xl">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="text-xs font-black uppercase text-brand-purple tracking-widest">Media (Max 20)</h3>
                                        <span className="text-[10px] font-bold text-gray-500">{mediaFiles.length}/20</span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-2 mb-4">
                                        <div className="aspect-square bg-gray-900/50 rounded-xl border-2 border-dashed border-white/10 flex items-center justify-center relative hover:border-brand-purple hover:bg-brand-purple/5 transition-all">
                                            <input type="file" multiple accept="image/*,video/*" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                            <span className="text-2xl text-gray-600">＋</span>
                                        </div>
                                        {mediaFiles.map((m, idx) => (
                                            <div key={m.id} className="aspect-square bg-gray-900 rounded-xl overflow-hidden relative border border-white/5 group">
                                                <img src={m.previewUrl} className="w-full h-full object-cover" alt="" />
                                                <button onClick={() => setMediaFiles(p => p.filter(x => x.id !== m.id))} className="absolute top-1 right-1 bg-black/60 text-white w-5 h-5 rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                <section className="bg-gray-800/30 p-6 rounded-3xl border border-white/5 shadow-xl">
                                    <h3 className="text-xs font-black uppercase mb-4 text-brand-purple tracking-widest">Soundtrack</h3>
                                    <div className="grid grid-cols-2 gap-2 mb-4">
                                        <div className="relative">
                                            <button className="w-full bg-gray-800 border border-white/5 py-3 rounded-xl text-[10px] font-black uppercase text-gray-500 hover:text-white transition-colors">Local File</button>
                                            <input type="file" accept="audio/*" onChange={(e) => {
                                                if (e.target.files?.[0]) {
                                                    const f = e.target.files[0];
                                                    const url = URL.createObjectURL(f);
                                                    setAudioFiles(p => [...p, { id: Math.random().toString(36).substr(2,9), name: f.name, duration: 300, startTime: 0, previewUrl: url, source: 'local' }]);
                                                }
                                            }} className="absolute inset-0 opacity-0 cursor-pointer" />
                                        </div>
                                        <button onClick={() => setIsMusicBrowserOpen(true)} className="w-full bg-apple-red/10 py-3 rounded-xl text-[10px] font-black uppercase text-apple-red border border-apple-red/20 hover:bg-apple-red hover:text-white transition-colors">Apple Music</button>
                                    </div>
                                    <div className="space-y-2">
                                        {audioFiles.map(a => (
                                            <div key={a.id} className="bg-black/20 p-3 rounded-xl text-[10px] flex justify-between items-center border border-white/5">
                                                <span className="truncate max-w-[150px] font-bold text-gray-300">{a.name}</span>
                                                <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))} className="text-gray-600">✕</button>
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                <section className="bg-gray-800/30 p-6 rounded-3xl border border-white/5 shadow-xl">
                                    <h3 className="text-xs font-black uppercase mb-4 text-brand-purple tracking-widest">Motion Styles</h3>
                                    <div className="grid grid-cols-2 gap-2 mb-4">
                                        {['ken-burns', 'fade-in', 'slide-from-right', 'zoom-in'].map(style => (
                                            <button key={style} onClick={() => setSettings(s => ({...s, slideStyle: style}))} className={`py-3 rounded-xl text-[10px] font-black uppercase border transition-all ${settings.slideStyle === style ? 'bg-brand-purple text-white border-brand-purple shadow-lg' : 'bg-gray-800 border-white/5 text-gray-500 hover:border-white/10'}`}>
                                                {style.replace(/-/g, ' ')}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="mt-6">
                                        <label className="text-[10px] font-black uppercase text-gray-500 tracking-widest mb-3 block">Frame Duration: <span className="text-white">{settings.interval}s</span></label>
                                        <input type="range" min="1" max="20" step="1" value={settings.interval} onChange={(e) => setSettings(s => ({ ...s, interval: parseInt(e.target.value) }))} className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-purple" />
                                    </div>
                                </section>
                            </div>

                            <div className="md:col-span-8 space-y-8">
                                <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-white/5 shadow-2xl relative overflow-hidden group">
                                    <div className="aspect-video bg-gray-950 rounded-[3rem] border border-white/10 flex items-center justify-center relative overflow-hidden">
                                        {mediaFiles.length > 0 ? (
                                            <div className="w-full h-full relative">
                                                <img src={mediaFiles[0].previewUrl} className="w-full h-full object-cover opacity-20 blur-xl scale-110" alt="" />
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="w-24 h-24 bg-brand-purple rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(109,40,217,0.4)] hover:scale-110 transition-transform active:scale-95">
                                                        <svg className="w-10 h-10 text-white ml-2" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-center p-12 opacity-10 flex flex-col items-center">
                                                <div className="w-24 h-24 bg-gray-900 border border-white/10 rounded-[2.5rem] flex items-center justify-center mb-6 text-4xl shadow-2xl">🎬</div>
                                                <p className="text-xs font-black uppercase tracking-[0.3em]">Timeline Empty</p>
                                            </div>
                                        )}
                                    </div>
                                </section>
                                
                                <section className="space-y-6">
                                    <h3 className="text-xs font-black uppercase text-gray-500 tracking-widest px-4">Cloud Collection Vault</h3>
                                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {ownedSlideshows.map(ss => (
                                            <div key={ss.id} className="bg-gray-800/20 p-6 rounded-[2.5rem] border border-white/5 hover:border-brand-purple transition-all group shadow-xl" onClick={() => loadProject(ss)}>
                                                <div className="aspect-square bg-gray-900 rounded-[2rem] mb-5 overflow-hidden relative border border-white/5">
                                                    {ss.media[0] && <img src={ss.media[0].previewUrl} className="w-full h-full object-cover opacity-40 group-hover:scale-105 transition-transform" alt="" />}
                                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60">
                                                        <span className="bg-white text-brand-dark px-6 py-2.5 rounded-full font-black text-xs uppercase tracking-widest shadow-2xl">Edit Collection</span>
                                                    </div>
                                                </div>
                                                <h4 className="font-bold truncate text-sm mb-1 text-gray-200">{ss.name}</h4>
                                                <div className="flex gap-2 mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={(e) => { e.stopPropagation(); deleteDoc(doc(db, "slideshows", ss.id)); }} className="flex-1 bg-white/5 text-gray-500 py-2 rounded-xl text-[10px] font-black uppercase hover:text-red-500 transition-colors">Delete</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            </div>
                        </div>
                    )}
                </main>
            )}

            {isMusicBrowserOpen && (
                <div className="fixed inset-0 bg-black/98 z-[500] flex items-center justify-center p-6 backdrop-blur-3xl animate-fade-in">
                    <div className="bg-gray-950 w-full max-w-2xl h-[80vh] rounded-[4rem] border border-white/10 p-12 flex flex-col shadow-2xl">
                        <div className="flex justify-between items-center mb-12">
                            <h2 className="text-3xl font-black uppercase tracking-tighter text-white">Apple Music Browser</h2>
                            <button onClick={() => setIsMusicBrowserOpen(false)} className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center text-gray-500 hover:text-white border border-white/5">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                            {!isSimulationMode ? (
                                <div className="text-center py-24 space-y-10">
                                    <div className="text-7xl text-apple-red"></div>
                                    <button onClick={() => setIsSimulationMode(true)} className="bg-apple-red text-white px-16 py-5 rounded-full font-black text-xs uppercase tracking-[0.2em] shadow-[0_15px_40px_rgba(250,36,60,0.3)]">Browse Simulation</button>
                                </div>
                            ) : (
                                <div className="grid gap-4">
                                    {MOCK_TRACKS.map(track => (
                                        <div key={track.id} className="bg-white/5 p-6 rounded-[2.5rem] border border-white/5 flex justify-between items-center hover:bg-white/10 hover:border-brand-purple cursor-pointer transition-all group" onClick={() => { setAudioFiles(p => [...p, { ...track, startTime: elapsedTime }]); setIsMusicBrowserOpen(false); }}>
                                            <div className="flex items-center gap-5">
                                                <div className="w-14 h-14 bg-gray-900 rounded-2xl flex items-center justify-center text-xl">🎵</div>
                                                <div className="flex flex-col">
                                                    <span className="font-black text-white text-base tracking-tight">{track.name}</span>
                                                    <span className="text-[10px] text-gray-600 uppercase font-black">{Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2,'0')}</span>
                                                </div>
                                            </div>
                                            <button className="bg-brand-purple/20 text-brand-purple px-8 py-3 rounded-2xl text-[10px] font-black uppercase group-hover:bg-brand-purple group-hover:text-white transition-all">Add Track</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {isPlaying && (
                <div className="fixed inset-0 bg-black z-[600] flex flex-col items-center justify-center animate-fade-in">
                    <button onClick={() => setIsPlaying(false)} className="absolute top-10 right-10 text-white/20 hover:text-white p-5 z-[610] text-4xl transition-all cursor-pointer">✕</button>
                    <div className="w-full h-full relative overflow-hidden flex items-center justify-center">
                        {mediaWithTimestamps.map((m, idx) => (
                            <TheaterMedia key={m.id} media={m} isVisible={idx === currentSlide} slideStyle={settings.slideStyle} showCaptions={settings.showCaptions} globalVisualsMuted={trackMutes.visuals} />
                        ))}
                    </div>
                    <div className="absolute bottom-0 left-0 h-1.5 bg-brand-purple z-[620] transition-all duration-200 shadow-[0_0_30px_rgba(109,40,217,1)]" style={{ width: `${(elapsedTime / totalSlideshowDuration) * 100}%` }}></div>
                </div>
            )}
            
            {error && (
                <div className="fixed bottom-10 right-10 bg-red-600 text-white p-8 rounded-[2.5rem] shadow-2xl z-[700] flex gap-8 items-center border border-white/20 animate-slide-from-bottom">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase opacity-60 tracking-widest">Alert</span>
                        <p className="text-sm font-bold tracking-tight">{error}</p>
                    </div>
                    <button onClick={() => setError(null)} className="p-3 bg-white/20 hover:bg-white/40 rounded-full transition-all text-xs">✕</button>
                </div>
            )}
        </div>
    );
};

export default App;
