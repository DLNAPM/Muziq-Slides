
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
  isMuted?: boolean;
  videoVolume?: number; // 0 to 1
}

interface AppStateAudio {
    id: string;
    name: string;
    duration: number; 
    startTime: number; // Position on global timeline
    previewUrl: string; 
    source: 'local' | 'apple-music' | 'sfx';
    fadeIn?: boolean;
    fadeOut?: boolean;
    crossFade?: boolean;
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

// --- Added missing MOCK_TRACKS constant for Apple Music simulation mode ---
const MOCK_TRACKS: AppStateAudio[] = [
    { id: 'm1', name: 'Midnight City', duration: 243, startTime: 0, previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', source: 'apple-music', volume: 1 },
    { id: 'm2', name: 'Starboy', duration: 230, startTime: 0, previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', source: 'apple-music', volume: 1 },
    { id: 'm3', name: 'Blinding Lights', duration: 200, startTime: 0, previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', source: 'apple-music', volume: 1 },
    { id: 'm4', name: 'Levitating', duration: 203, startTime: 0, previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3', source: 'apple-music', volume: 1 },
    { id: 'm5', name: 'Save Your Tears', duration: 215, startTime: 0, previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3', source: 'apple-music', volume: 1 },
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

    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = media.isMuted ? 0 : (media.videoVolume ?? 1);
        }
    }, [media.isMuted, media.videoVolume]);

    return (
        <div className={`w-full h-full absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-700 ${isVisible ? 'opacity-100 z-20' : 'opacity-0 z-10'}`}>
            <div key={`${media.id}-${isVisible}`} className={`w-full h-full flex items-center justify-center ${animationClass}`}>
                {media.type === 'image' ? (
                    <img src={mediaUrl} className="w-full h-full object-contain" alt="slide" />
                ) : (
                    <video ref={videoRef} src={mediaUrl} className="w-full h-full object-contain" autoPlay muted={media.isMuted} loop />
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
    const audioPoolRef = useRef<Map<string, HTMLAudioElement>>(new Map());

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
        
        const qOwned = query(collection(db, "slideshows"), where("userId", "==", user.uid));
        const unsubOwned = onSnapshot(qOwned, (snap) => {
            const projects = snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow));
            setOwnedSlideshows(projects.map(p => ({...p, media: reconstructMedia(p.media)})));
        });

        const qShared = query(collection(db, "slideshows"), where("sharedWith", "array-contains", user.email?.toLowerCase()));
        const unsubShared = onSnapshot(qShared, (snap) => {
            const projects = snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow));
            setSharedSlideshows(projects.map(p => ({...p, media: reconstructMedia(p.media)})));
        });

        return () => { unsubOwned(); unsubShared(); };
    }, [user, reconstructMedia]);

    // --- AUDIO ENGINE ---
    useEffect(() => {
        if (isPlaying) {
            audioFiles.forEach(track => {
                let audio = audioPoolRef.current.get(track.id);
                if (!audio && track.previewUrl) {
                    audio = new Audio(track.previewUrl);
                    audioPoolRef.current.set(track.id, audio);
                }
                
                if (audio) {
                    const relativeTime = elapsedTime - track.startTime;
                    if (relativeTime >= 0 && relativeTime < track.duration) {
                        if (audio.paused) {
                            audio.currentTime = relativeTime;
                            audio.play().catch(() => {});
                        }
                        // Handle Fades
                        let targetVolume = track.volume ?? 1;
                        if (track.fadeIn && relativeTime < 2) targetVolume *= (relativeTime / 2);
                        if (track.fadeOut && relativeTime > track.duration - 2) targetVolume *= ((track.duration - relativeTime) / 2);
                        audio.volume = Math.max(0, Math.min(1, targetVolume));
                    } else {
                        if (!audio.paused) {
                            audio.pause();
                            audio.currentTime = 0;
                        }
                    }
                }
            });
        } else {
            audioPoolRef.current.forEach(audio => {
                audio.pause();
                audio.currentTime = 0;
            });
        }
    }, [isPlaying, elapsedTime, audioFiles]);

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
        const files: File[] = Array.from(e.target.files).slice(0, 20) as File[];
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
                source: 'local',
                volume: 1
            }]);
        };
    };

    const addSFX = (sfx: {name: string, url: string}) => {
        const audio = new Audio(sfx.url);
        audio.onloadedmetadata = () => {
            setAudioFiles(p => [...p, { 
                id: Math.random().toString(36).substr(2, 9), 
                name: sfx.name, 
                duration: audio.duration || 2, 
                startTime: elapsedTime, 
                previewUrl: sfx.url, 
                source: 'sfx',
                volume: 1
            }]);
        };
    };

    const moveMedia = (index: number, direction: 'up' | 'down') => {
        setMediaFiles(prev => {
            const next = [...prev];
            const target = direction === 'up' ? index - 1 : index + 1;
            if (target >= 0 && target < next.length) {
                [next[index], next[target]] = [next[target], next[index]];
            }
            return next;
        });
    };

    const toggleMuteMedia = (id: string) => {
        setMediaFiles(prev => prev.map(m => m.id === id ? { ...m, isMuted: !m.isMuted } : m));
    };

    // --- Using Gemini 3 Flash to generate evocative image captions ---
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

    const scrollTo = (id: string) => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
    };

    if (isLoading) return <div className="min-h-screen bg-brand-dark flex items-center justify-center"><div className="w-10 h-10 border-4 border-brand-purple border-t-transparent rounded-full animate-spin"></div></div>;

    const StudioTimeline = () => {
        const pixelsPerSecond = 20;
        return (
            <div className="bg-gray-900 rounded-[2rem] border border-white/5 p-8 space-y-4 overflow-x-auto">
                <div className="relative h-12 border-b border-white/5 mb-4 min-w-[1000px]">
                    {Array.from({length: Math.ceil(totalSlideshowDuration / 5) + 5}).map((_, i) => (
                        <div key={i} className="absolute text-[8px] font-black text-gray-700" style={{left: i * 5 * pixelsPerSecond}}>
                            {i * 5}s
                        </div>
                    ))}
                    <div className="absolute top-0 bottom-0 w-0.5 bg-brand-purple z-10" style={{left: elapsedTime * pixelsPerSecond}}></div>
                </div>

                {/* VISUALS TRACK */}
                <div className="flex items-center gap-4 min-w-[1000px]">
                    <div className="w-24 text-[10px] font-black uppercase tracking-widest text-gray-500">Visuals</div>
                    <div className="flex h-16 bg-white/5 rounded-xl flex-1 relative">
                        {mediaWithTimestamps.map((m) => (
                            <div key={m.id} className="h-full border-r border-black/20 overflow-hidden relative" style={{width: (m.timelineEnd! - m.timelineStart!) * pixelsPerSecond}}>
                                <img src={m.previewUrl} className="w-full h-full object-cover opacity-60" />
                                <div className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-white shadow-sm">{m.type === 'video' ? '🎬' : '📷'}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* MUSIC TRACK */}
                <div className="flex items-center gap-4 min-w-[1000px]">
                    <div className="w-24 text-[10px] font-black uppercase tracking-widest text-gray-500 flex flex-col gap-1">
                        <span>Music</span>
                        <button onClick={() => setIsMusicBrowserOpen(true)} className="text-[8px] bg-brand-purple/20 hover:bg-brand-purple/40 p-1 rounded transition-colors">Add</button>
                    </div>
                    <div className="h-16 bg-white/5 rounded-xl flex-1 relative">
                        {audioFiles.filter(a => a.source !== 'sfx').map((a) => (
                            <div key={a.id} className="absolute h-full bg-brand-purple/40 border border-brand-purple/40 rounded-xl p-2 group cursor-move" style={{left: a.startTime * pixelsPerSecond, width: a.duration * pixelsPerSecond}}>
                                <div className="flex justify-between items-center h-full">
                                    <span className="text-[9px] font-bold truncate px-2">{a.name}</span>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                                        <button onClick={() => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, fadeIn: !x.fadeIn} : x))} className={`p-1 rounded text-[8px] ${a.fadeIn ? 'bg-brand-purple' : 'bg-black/40'}`}>IN</button>
                                        <button onClick={() => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, fadeOut: !x.fadeOut} : x))} className={`p-1 rounded text-[8px] ${a.fadeOut ? 'bg-brand-purple' : 'bg-black/40'}`}>OUT</button>
                                        <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))} className="p-1 rounded text-[8px] bg-red-500">✕</button>
                                    </div>
                                </div>
                                <input type="range" className="absolute -bottom-1 left-0 right-0 h-1 accent-brand-purple opacity-0 group-hover:opacity-100" min="0" max={totalSlideshowDuration} step="0.1" value={a.startTime} onChange={(e) => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, startTime: parseFloat(e.target.value)} : x))} />
                            </div>
                        ))}
                    </div>
                </div>

                {/* SFX TRACK */}
                <div className="flex items-center gap-4 min-w-[1000px]">
                    <div className="w-24 text-[10px] font-black uppercase tracking-widest text-gray-500">SFX</div>
                    <div className="h-12 bg-white/5 rounded-xl flex-1 relative">
                        {audioFiles.filter(a => a.source === 'sfx').map((a) => (
                            <div key={a.id} className="absolute h-full bg-apple-red/40 border border-apple-red/40 rounded-xl p-2 group cursor-move" style={{left: a.startTime * pixelsPerSecond, width: a.duration * pixelsPerSecond}}>
                                <span className="text-[8px] font-bold truncate">{a.name}</span>
                                <input type="range" className="absolute -bottom-1 left-0 right-0 h-1 accent-apple-red opacity-0 group-hover:opacity-100" min="0" max={totalSlideshowDuration} step="0.1" value={a.startTime} onChange={(e) => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, startTime: parseFloat(e.target.value)} : x))} />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className={`min-h-screen font-sans bg-brand-dark text-gray-200 overflow-x-hidden`}>
            {/* STICKY HEADER */}
            <header className="fixed top-0 left-0 right-0 p-4 flex justify-between items-center z-[100] bg-gray-900/40 backdrop-blur-2xl border-b border-white/5">
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})}>
                    <div className="w-8 h-8 bg-brand-purple rounded-lg flex items-center justify-center font-black text-white shadow-lg shadow-brand-purple/20">M</div>
                    <h1 className="text-xl font-bold tracking-tight text-white uppercase"><span className="text-brand-purple">Muziq</span> Slides</h1>
                </div>
                
                <nav className="hidden md:flex items-center gap-8">
                    <button onClick={() => scrollTo('features')} className="text-xs font-black uppercase tracking-widest text-gray-400 hover:text-white transition-colors">Features</button>
                    <button onClick={() => { if(!user) handleGoogleLogin(); else setViewMode('studio'); }} className={`text-xs font-black uppercase tracking-widest transition-colors ${viewMode === 'studio' ? 'text-brand-purple' : 'text-gray-400 hover:text-white'}`}>Studio</button>
                    <button onClick={() => scrollTo('support')} className="text-xs font-black uppercase tracking-widest text-gray-400 hover:text-white transition-colors">Support</button>
                </nav>

                <div className="flex items-center gap-4">
                    {user ? (
                        <div className="flex items-center gap-3">
                            <span className="hidden sm:inline text-xs font-bold text-gray-400">{user.email}</span>
                            <button onClick={() => signOut(auth)} className="text-xs bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg font-bold border border-white/5 transition-colors">Logout</button>
                        </div>
                    ) : (
                        <button onClick={handleGoogleLogin} className="text-xs bg-brand-purple hover:bg-brand-purple/80 px-6 py-2.5 rounded-full font-black uppercase tracking-widest text-white shadow-2xl transition-all hover:scale-105 active:scale-95">Sign In</button>
                    )}
                </div>
            </header>

            {!user ? (
                <main className="animate-fade-in">
                    {/* HERO SECTION */}
                    <section className="min-h-screen flex flex-col items-center justify-center text-center px-4 pt-20 bg-gradient-to-b from-brand-dark to-gray-900">
                        <div className="space-y-4 mb-12">
                            <h2 className="text-7xl md:text-[9rem] font-black tracking-tighter text-white leading-none">Muziq Slides</h2>
                            <p className="text-xl md:text-2xl font-bold text-brand-purple tracking-widest uppercase opacity-80">Powered by Gemini</p>
                        </div>
                        
                        <div className="space-y-6 w-full max-w-md">
                            <p className="text-gray-400 text-lg leading-relaxed mb-8">Elevate your memories with cinematic slideshows, perfectly synced with Apple Music and enhanced by AI intelligence.</p>
                            <button onClick={handleGoogleLogin} className="w-full bg-white text-brand-dark py-5 rounded-full font-black uppercase tracking-widest text-sm flex items-center justify-center gap-3 shadow-2xl hover:scale-105 transition-transform active:scale-95">
                                <svg className="w-6 h-6" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                                Continue with Google
                            </button>
                            <p className="text-[10px] uppercase font-black tracking-widest text-gray-600">Secure Authentication via Firebase</p>
                        </div>
                    </section>
                </main>
            ) : (
                <main className="p-4 max-w-7xl mx-auto py-24 animate-fade-in">
                    <div className="flex justify-between items-center mb-12">
                        <input 
                            value={slideshowName} 
                            onChange={(e) => setSlideshowName(e.target.value)} 
                            placeholder="Untitled Slideshow" 
                            className="bg-transparent text-5xl md:text-7xl font-black text-white/90 outline-none w-full placeholder:text-white/10 tracking-tighter" 
                        />
                        <div className="flex gap-4">
                            <button onClick={() => setViewMode(v => v === 'easy' ? 'studio' : 'easy')} className={`px-8 py-3 rounded-full text-xs font-bold border transition-all ${viewMode === 'studio' ? 'bg-brand-purple border-brand-purple' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>Studio Mode</button>
                            <button onClick={saveSlideshow} className="bg-white/5 hover:bg-white/10 text-white px-8 py-3 rounded-full text-xs font-bold border border-white/10">Save</button>
                            <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="bg-brand-purple text-white px-10 py-3 rounded-full text-xs font-bold shadow-2xl hover:scale-105 active:scale-95 transition-all">Preview</button>
                        </div>
                    </div>

                    {viewMode === 'studio' ? (
                        <div className="space-y-8">
                            <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-white/5">
                                <h3 className="text-xs font-black uppercase mb-6 text-brand-purple tracking-widest">Multi-Track Editor</h3>
                                <StudioTimeline />
                            </section>

                            <div className="grid md:grid-cols-2 gap-8">
                                <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-white/5">
                                    <h3 className="text-xs font-black uppercase mb-6 text-brand-purple tracking-widest">Sound Effects Track</h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        {SFX_OPTIONS.map(sfx => (
                                            <button key={sfx.name} onClick={() => addSFX(sfx)} className="bg-gray-900/60 p-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-white/5 hover:border-brand-purple hover:bg-brand-purple/10 transition-all flex items-center justify-between group">
                                                {sfx.name}
                                                <span className="opacity-0 group-hover:opacity-100">+</span>
                                            </button>
                                        ))}
                                    </div>
                                </section>
                                <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-white/5">
                                    <h3 className="text-xs font-black uppercase mb-6 text-brand-purple tracking-widest">Video Audio Control</h3>
                                    <div className="space-y-4">
                                        {mediaFiles.filter(m => m.type === 'video').map(m => (
                                            <div key={m.id} className="flex items-center gap-4 bg-gray-900/60 p-4 rounded-2xl border border-white/5">
                                                <img src={m.previewUrl} className="w-12 h-12 rounded-lg object-cover" />
                                                <div className="flex-1">
                                                    <div className="flex justify-between text-[10px] font-black uppercase text-gray-500 mb-2">
                                                        <span>Volume</span>
                                                        <span>{m.isMuted ? 'Muted' : `${Math.round((m.videoVolume ?? 1) * 100)}%`}</span>
                                                    </div>
                                                    <input type="range" min="0" max="1" step="0.01" value={m.isMuted ? 0 : (m.videoVolume ?? 1)} onChange={(e) => setMediaFiles(p => p.map(x => x.id === m.id ? {...x, videoVolume: parseFloat(e.target.value), isMuted: parseFloat(e.target.value) === 0} : x))} className="w-full accent-brand-purple h-1 bg-gray-700 rounded-full" />
                                                </div>
                                            </div>
                                        ))}
                                        {mediaFiles.filter(m => m.type === 'video').length === 0 && <p className="text-xs text-gray-600 italic">No videos in timeline.</p>}
                                    </div>
                                </section>
                            </div>
                        </div>
                    ) : (
                        <div className="grid lg:col-span-12 gap-8">
                             <div className="grid md:grid-cols-12 gap-8">
                                <div className="md:col-span-4 space-y-6">
                                    <section className="bg-gray-800/30 p-6 rounded-3xl border border-white/5">
                                        <h3 className="text-xs font-black uppercase mb-4 text-brand-purple tracking-widest">Media (Max 20)</h3>
                                        <div className="grid grid-cols-4 gap-2 mb-4">
                                            <div className="aspect-square bg-gray-900/50 rounded-xl border-2 border-dashed border-gray-700 flex items-center justify-center relative hover:border-brand-purple cursor-pointer group">
                                                <input type="file" multiple accept="image/*,video/*" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                                <span className="text-2xl text-gray-500">＋</span>
                                            </div>
                                            {mediaFiles.map((m, idx) => (
                                                <div key={m.id} className="aspect-square bg-gray-900 rounded-xl overflow-hidden relative border border-gray-800 group">
                                                    <img src={m.previewUrl} className="w-full h-full object-cover" alt="" />
                                                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-1">
                                                        <div className="flex gap-1">
                                                            <button onClick={() => moveMedia(idx, 'up')} className="bg-white/20 hover:bg-white/40 text-white p-1.5 rounded-lg text-xs">←</button>
                                                            <button onClick={() => moveMedia(idx, 'down')} className="bg-white/20 hover:bg-white/40 text-white p-1.5 rounded-lg text-xs">→</button>
                                                        </div>
                                                        <button onClick={() => setMediaFiles(p => p.filter(x => x.id !== m.id))} className="bg-red-500 hover:bg-red-600 text-white p-1.5 rounded-lg text-xs">✕</button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        {mediaFiles.length > 0 && (
                                            <button onClick={generateSmartCaptions} disabled={isProcessingCaptions} className="w-full bg-brand-purple/10 text-brand-purple py-3 rounded-2xl text-[10px] font-black uppercase border border-brand-purple/20 hover:bg-brand-purple hover:text-white transition-all">
                                                {isProcessingCaptions ? 'Polishing...' : '✨ AI Smart Captions'}
                                            </button>
                                        )}
                                    </section>

                                    <section className="bg-gray-800/30 p-6 rounded-3xl border border-white/5">
                                        <h3 className="text-xs font-black uppercase mb-4 text-brand-purple tracking-widest">Quick Transitions</h3>
                                        <div className="mt-6">
                                            <label className="text-[10px] font-black uppercase text-gray-500 tracking-widest mb-3 block">Timing: <span className="text-white">{settings.interval}s</span></label>
                                            <input 
                                                type="range" 
                                                min="1" 
                                                max="20" 
                                                step="1"
                                                value={settings.interval}
                                                onChange={(e) => setSettings(s => ({ ...s, interval: parseInt(e.target.value) }))}
                                                className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-purple"
                                            />
                                        </div>
                                    </section>
                                </div>

                                <div className="md:col-span-8">
                                    <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-white/5">
                                        <div className="aspect-video bg-gray-950 rounded-[3rem] relative overflow-hidden border border-white/5 flex items-center justify-center">
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
                                </div>
                             </div>
                        </div>
                    )}
                </main>
            )}

            {isMusicBrowserOpen && (
                <div className="fixed inset-0 bg-black/95 z-[500] flex items-center justify-center p-6 backdrop-blur-2xl animate-fade-in">
                    <div className="bg-gray-950 w-full max-w-2xl h-[80vh] rounded-[4rem] border border-white/10 p-12 flex flex-col shadow-2xl">
                        <div className="flex justify-between items-center mb-12">
                            <h2 className="text-3xl font-black uppercase tracking-tighter text-white">Apple Music</h2>
                            <button onClick={() => setIsMusicBrowserOpen(false)} className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center text-gray-500 hover:text-white transition-all">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                            {!appleMusicAuthorized && !isSimulationMode ? (
                                <div className="text-center py-20 bg-gray-900/50 rounded-[3rem] border border-white/5">
                                    <div className="w-20 h-20 bg-apple-red/20 text-apple-red rounded-[2rem] flex items-center justify-center mx-auto mb-8 text-3xl shadow-xl"></div>
                                    <h3 className="text-xl font-bold mb-4 text-white">Connect Library</h3>
                                    <p className="text-xs text-gray-500 mb-10 max-w-xs mx-auto leading-relaxed">Authorize Muziq Slides to browse your Apple Music library.</p>
                                    <button onClick={handleAuthorizeApple} className="bg-apple-red text-white px-12 py-4 rounded-full font-bold shadow-2xl text-sm uppercase tracking-widest">Authorize Now</button>
                                    <button onClick={() => setIsSimulationMode(true)} className="block w-full mt-6 text-[10px] uppercase font-black text-gray-600 hover:text-brand-purple">Or use simulation mode</button>
                                </div>
                            ) : (
                                <div className="grid gap-4">
                                    {MOCK_TRACKS.map(track => (
                                        <div key={track.id} className="bg-gray-900/60 p-5 rounded-[2rem] border border-white/5 flex justify-between items-center hover:border-brand-purple group cursor-pointer transition-all hover:bg-gray-900" onClick={() => { setAudioFiles(p => [...p, { ...track, startTime: elapsedTime }]); setIsMusicBrowserOpen(false); }}>
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
                <div className="fixed inset-0 bg-black z-[600] flex flex-col items-center justify-center animate-fade-in">
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
