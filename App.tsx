
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
    originalDuration?: number;
    startTime: number; 
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
    }, [media.isMuted, media.videoVolume, isVisible]);

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
                    audio.crossOrigin = "anonymous";
                    audioPoolRef.current.set(track.id, audio);
                }
                
                if (audio) {
                    const relativeTime = elapsedTime - track.startTime;
                    if (relativeTime >= 0 && relativeTime < track.duration) {
                        if (audio.paused) {
                            audio.currentTime = relativeTime;
                            audio.play().catch(e => console.warn("Audio play blocked by browser:", e));
                        }
                        
                        // Volume Logic
                        let targetVolume = (track.volume !== undefined) ? track.volume : 0.8;
                        if (track.fadeIn && relativeTime < 2) targetVolume *= (relativeTime / 2);
                        if (track.fadeOut && relativeTime > track.duration - 2) targetVolume *= ((track.duration - relativeTime) / 2);
                        
                        // Apply volume directly to audio element
                        const finalVolume = Math.max(0, Math.min(1, targetVolume));
                        if (audio.volume !== finalVolume) {
                            audio.volume = finalVolume;
                        }
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
                originalDuration: audio.duration,
                startTime: 0, 
                previewUrl, 
                source: 'local',
                volume: 0.8
            }]);
        };
    };

    const addSFX = (sfx: {name: string, url: string}) => {
        // Immediate preview playback
        const preview = new Audio(sfx.url);
        preview.volume = 0.8;
        preview.play().catch(() => {});

        const audio = new Audio(sfx.url);
        audio.onloadedmetadata = () => {
            setAudioFiles(p => [...p, { 
                id: Math.random().toString(36).substr(2, 9), 
                name: sfx.name, 
                duration: audio.duration || 2, 
                originalDuration: audio.duration || 2,
                startTime: elapsedTime, 
                previewUrl: sfx.url, 
                source: 'sfx',
                volume: 0.8
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
        setMediaFiles(prev => prev.map(m => 
            m.id === id ? { ...m, isMuted: !m.isMuted } : m
        ));
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
        const projectData = {
            userId: user.uid,
            name: slideshowName || `Slideshow ${new Date().toLocaleDateString()}`,
            media: mediaFiles.map(({ previewUrl, ...rest }) => ({ ...rest, previewUrl: '' })), 
            audio: audioFiles.map(({ previewUrl, ...rest }) => ({ ...rest, previewUrl: '' })), 
            settings: settings,
            sharedWith: [], 
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

    const StudioTimeline = () => {
        const pixelsPerSecond = 20;
        return (
            <div className="bg-gray-900 rounded-[2rem] border border-white/5 p-8 space-y-4 overflow-x-auto relative shadow-inner">
                <div className="relative h-12 border-b border-white/5 mb-4 min-w-[1000px]">
                    {Array.from({length: Math.ceil(Math.max(totalSlideshowDuration, 60) / 5) + 5}).map((_, i) => (
                        <div key={i} className="absolute text-[8px] font-black text-gray-700" style={{left: i * 5 * pixelsPerSecond}}>
                            {i * 5}s
                        </div>
                    ))}
                    <div className="absolute top-0 bottom-0 w-0.5 bg-brand-purple z-10 transition-all duration-100 shadow-[0_0_10px_rgba(109,40,217,0.5)]" style={{left: elapsedTime * pixelsPerSecond}}></div>
                </div>

                {/* VISUALS TRACK */}
                <div className="flex items-center gap-4 min-w-[1000px]">
                    <div className="w-32 text-[10px] font-black uppercase tracking-widest text-gray-500">Visuals</div>
                    <div className="flex h-16 bg-white/5 rounded-xl flex-1 relative border border-white/5">
                        {mediaWithTimestamps.map((m) => (
                            <div key={m.id} className="h-full border-r border-black/20 overflow-hidden relative" style={{width: (m.timelineEnd! - m.timelineStart!) * pixelsPerSecond}}>
                                <img src={m.previewUrl} className="w-full h-full object-cover opacity-60" alt="" />
                                <div className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-white shadow-sm bg-black/20">{m.type === 'video' ? '🎬' : '📷'}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* MUSIC TRACK */}
                <div className="flex items-center gap-4 min-w-[1000px]">
                    <div className="w-32 text-[10px] font-black uppercase tracking-widest text-gray-500 flex flex-col gap-1">
                        <span>Music</span>
                        <button onClick={() => setIsMusicBrowserOpen(true)} className="text-[8px] bg-brand-purple/20 hover:bg-brand-purple/40 p-1 rounded transition-colors uppercase font-bold text-brand-purple">Add Track</button>
                    </div>
                    <div className="h-28 bg-white/5 rounded-xl flex-1 relative border border-white/5">
                        {audioFiles.filter(a => a.source !== 'sfx').map((a) => (
                            <div key={a.id} className="absolute h-24 bg-brand-purple/30 border border-brand-purple/40 rounded-xl p-3 group shadow-lg" style={{left: a.startTime * pixelsPerSecond, width: a.duration * pixelsPerSecond}}>
                                <div className="flex flex-col gap-2 h-full">
                                    <div className="flex justify-between items-center">
                                        <span className="text-[9px] font-bold truncate max-w-[100px] text-white">{a.name}</span>
                                        <div className="flex gap-1">
                                            <button onClick={() => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, fadeIn: !x.fadeIn} : x))} className={`p-1 rounded text-[8px] font-bold ${a.fadeIn ? 'bg-brand-purple text-white shadow-sm' : 'bg-black/40 text-gray-400'}`}>FADE IN</button>
                                            <button onClick={() => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, fadeOut: !x.fadeOut} : x))} className={`p-1 rounded text-[8px] font-bold ${a.fadeOut ? 'bg-brand-purple text-white shadow-sm' : 'bg-black/40 text-gray-400'}`}>FADE OUT</button>
                                            <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))} className="p-1 rounded text-[8px] bg-red-600 text-white">✕</button>
                                        </div>
                                    </div>

                                    {/* VOLUME CONTROL */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-[8px] font-black text-gray-400">VOL</span>
                                        <input 
                                            type="range" 
                                            min="0" max="1" step="0.01" 
                                            value={a.volume ?? 0.8} 
                                            onChange={(e) => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, volume: parseFloat(e.target.value)} : x))}
                                            className="flex-1 h-1 accent-white appearance-none bg-white/20 rounded-full cursor-pointer" 
                                        />
                                    </div>

                                    {/* POSITION CONTROL */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-[8px] font-black text-gray-400">POS</span>
                                        <input 
                                            type="range" 
                                            min="0" max={Math.max(totalSlideshowDuration, 60)} step="0.1" 
                                            value={a.startTime} 
                                            onChange={(e) => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, startTime: parseFloat(e.target.value)} : x))}
                                            className="flex-1 h-1 accent-brand-purple appearance-none bg-brand-purple/20 rounded-full cursor-pointer" 
                                        />
                                    </div>

                                    {/* TRIM CONTROL */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-[8px] font-black text-gray-400">TRIM</span>
                                        <input 
                                            type="range" 
                                            min="0.5" max={a.originalDuration || a.duration || 10} step="0.1" 
                                            value={a.duration} 
                                            onChange={(e) => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, duration: parseFloat(e.target.value)} : x))}
                                            className="flex-1 h-1 accent-apple-red appearance-none bg-apple-red/20 rounded-full cursor-pointer" 
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* SFX TRACK */}
                <div className="flex items-center gap-4 min-w-[1000px]">
                    <div className="w-32 text-[10px] font-black uppercase tracking-widest text-gray-500">SFX</div>
                    <div className="h-24 bg-white/5 rounded-xl flex-1 relative border border-white/5">
                        {audioFiles.filter(a => a.source === 'sfx').map((a) => (
                            <div key={a.id} className="absolute h-20 bg-apple-red/30 border border-apple-red/40 rounded-xl p-3 group shadow-lg" style={{left: a.startTime * pixelsPerSecond, width: a.duration * pixelsPerSecond}}>
                                <div className="flex flex-col gap-2 h-full">
                                    <div className="flex justify-between items-center">
                                        <span className="text-[8px] font-bold truncate max-w-[80px] text-white">{a.name}</span>
                                        <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))} className="text-[8px] bg-black/40 p-1 rounded text-white">✕</button>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="range" 
                                            min="0" max={Math.max(totalSlideshowDuration, 60)} step="0.1" 
                                            value={a.startTime} 
                                            onChange={(e) => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, startTime: parseFloat(e.target.value)} : x))}
                                            className="flex-1 h-0.5 accent-apple-red appearance-none bg-apple-red/20 rounded-full" 
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="range" 
                                            min="0" max="1" step="0.1" 
                                            value={a.volume ?? 0.8} 
                                            onChange={(e) => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, volume: parseFloat(e.target.value)} : x))}
                                            className="flex-1 h-0.5 accent-white appearance-none bg-white/20 rounded-full" 
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    if (isLoading) return <div className="min-h-screen bg-brand-dark flex items-center justify-center"><div className="w-10 h-10 border-4 border-brand-purple border-t-transparent rounded-full animate-spin"></div></div>;

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
                    <button onClick={() => { if(!user) handleGoogleLogin(); else setViewMode('studio'); }} className={`text-xs font-black uppercase tracking-widest transition-colors ${viewMode === 'studio' ? 'text-brand-purple underline decoration-2 underline-offset-8' : 'text-gray-400 hover:text-white'}`}>Studio</button>
                    <button onClick={() => scrollTo('support')} className="text-xs font-black uppercase tracking-widest text-gray-400 hover:text-white transition-colors">Support</button>
                </nav>
                <div className="flex items-center gap-4">
                    {user ? (
                        <div className="flex items-center gap-3">
                            <span className="hidden sm:inline text-xs font-bold text-gray-400">{user.email}</span>
                            <button onClick={() => signOut(auth)} className="text-xs bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg font-bold border border-white/5 transition-colors">Logout</button>
                        </div>
                    ) : (
                        <button onClick={handleGoogleLogin} className="text-xs bg-brand-purple hover:bg-brand-purple/80 px-6 py-2.5 rounded-full font-black uppercase tracking-widest text-white shadow-2xl transition-all">Sign In</button>
                    )}
                </div>
            </header>

            {!user ? (
                <main className="animate-fade-in">
                    {/* HERO */}
                    <section className="min-h-screen flex flex-col items-center justify-center text-center px-4 pt-20 bg-gradient-to-b from-brand-dark to-gray-900">
                        <div className="space-y-4 mb-12">
                            <h2 className="text-7xl md:text-[9rem] font-black tracking-tighter text-white leading-none">Muziq Slides</h2>
                            <p className="text-xl md:text-2xl font-bold text-brand-purple tracking-widest uppercase opacity-80">Powered by Gemini</p>
                        </div>
                        <div className="space-y-6 w-full max-w-md">
                            <p className="text-gray-400 text-lg leading-relaxed mb-8">Elevate your memories with cinematic slideshows, perfectly synced with Apple Music and enhanced by AI intelligence.</p>
                            <button onClick={handleGoogleLogin} className="w-full bg-white text-brand-dark py-5 rounded-full font-black uppercase tracking-widest text-sm flex items-center justify-center gap-3 shadow-2xl hover:scale-105 transition-transform">
                                Continue with Google
                            </button>
                        </div>
                    </section>
                    {/* FEATURES */}
                    <div id="features">
                        <section className="min-h-screen flex flex-col md:flex-row items-center justify-center p-8 md:p-24 gap-16 border-t border-white/5">
                            <div className="md:w-1/2 space-y-8">
                                <span className="text-brand-purple font-black uppercase tracking-[0.3em] text-xs block">Cinematic Canvas</span>
                                <h3 className="text-5xl md:text-7xl font-black tracking-tighter text-white">20 High-Res Collections.</h3>
                                <p className="text-xl text-gray-400 leading-relaxed">Upload up to 20 images or videos. Every frame is optimized for high-performance rendering.</p>
                            </div>
                            <div className="md:w-1/2 bg-gray-800/20 aspect-video rounded-[3rem] border border-white/5 flex items-center justify-center">
                                <div className="grid grid-cols-4 gap-4 w-full h-full p-8 opacity-40">
                                    {[1,2,3,4,5,6,7,8].map(i => <div key={i} className="aspect-square bg-gray-700/50 rounded-2xl"></div>)}
                                </div>
                            </div>
                        </section>
                        <section className="min-h-screen flex flex-col md:flex-row-reverse items-center justify-center p-8 md:p-24 gap-16 bg-white/[0.02]">
                            <div className="md:w-1/2 space-y-8">
                                <span className="text-apple-red font-black uppercase tracking-[0.3em] text-xs block">Perfect Harmony</span>
                                <h3 className="text-5xl md:text-7xl font-black tracking-tighter text-white">Apple Music Sync.</h3>
                                <p className="text-xl text-gray-400 leading-relaxed">Connect your library and pair your favorite tracks with your visual story. Choose from your playlists or our simulation tracks.</p>
                            </div>
                            <div className="md:w-1/2 bg-apple-red/5 aspect-video rounded-[3rem] border border-apple-red/10 flex items-center justify-center p-12 text-[10rem] text-apple-red opacity-20"></div>
                        </section>
                    </div>
                    {/* FOOTER */}
                    <footer id="support" className="bg-gray-950 border-t border-white/5 py-32 px-8">
                        <div className="max-w-7xl mx-auto grid md:grid-cols-4 gap-16">
                            <div className="col-span-2 space-y-8">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-brand-purple rounded-lg flex items-center justify-center font-black text-white">M</div>
                                    <h1 className="text-xl font-bold tracking-tight text-white uppercase"><span className="text-brand-purple">Muziq</span> Slides</h1>
                                </div>
                                <p className="text-gray-500 text-lg leading-relaxed max-w-sm">Premier destination for cinematic memory storytelling. Powered by Google Gemini AI.</p>
                            </div>
                            <div className="space-y-6">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-purple">Legal</h4>
                                <ul className="space-y-4 text-sm text-gray-500">
                                    <li>Privacy Policy</li>
                                    <li>Terms of Service</li>
                                </ul>
                            </div>
                            <div className="space-y-6">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-purple">Support</h4>
                                <ul className="space-y-4 text-sm text-gray-500">
                                    <li>support@muziqslides.com</li>
                                    <li>Help Center</li>
                                </ul>
                            </div>
                        </div>
                    </footer>
                </main>
            ) : (
                <main className="p-4 max-w-7xl mx-auto py-24 animate-fade-in">
                    <div className="flex flex-col md:flex-row justify-between items-center mb-12 gap-6">
                        <input 
                            value={slideshowName} 
                            onChange={(e) => setSlideshowName(e.target.value)} 
                            placeholder="Untitled Slideshow" 
                            className="bg-transparent text-5xl md:text-7xl font-black text-white/90 outline-none w-full placeholder:text-white/10 tracking-tighter" 
                        />
                        <div className="flex flex-wrap gap-4 shrink-0">
                            {viewMode === 'studio' && (
                                <button onClick={() => setViewMode('easy')} className="bg-white/10 hover:bg-white/20 text-white px-8 py-3 rounded-full text-xs font-bold border border-white/10 flex items-center gap-2 transition-colors">
                                    <span>← Exit Studio</span>
                                </button>
                            )}
                            <button onClick={() => setViewMode(v => v === 'easy' ? 'studio' : 'easy')} className={`px-8 py-3 rounded-full text-xs font-bold border transition-all ${viewMode === 'studio' ? 'bg-brand-purple border-brand-purple shadow-[0_0_15px_rgba(109,40,217,0.4)]' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>Studio</button>
                            <button onClick={saveSlideshow} className="bg-white/5 hover:bg-white/10 text-white px-8 py-3 rounded-full text-xs font-bold border border-white/10 transition-colors">Save</button>
                            <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="bg-brand-purple text-white px-10 py-3 rounded-full text-xs font-bold shadow-2xl hover:scale-105 transition-transform">Preview</button>
                        </div>
                    </div>

                    {viewMode === 'studio' ? (
                        <div className="space-y-8 animate-fade-in">
                            <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-white/5 shadow-2xl">
                                <div className="flex justify-between items-center mb-6">
                                    <div className="flex items-center gap-6">
                                        <h3 className="text-xs font-black uppercase text-brand-purple tracking-widest">Multi-Track Editor</h3>
                                        <div className="flex items-center gap-2 bg-black/40 p-1.5 rounded-full border border-white/5">
                                            <button 
                                                onClick={() => setIsPlaying(!isPlaying)} 
                                                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isPlaying ? 'bg-brand-purple text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
                                            >
                                                {isPlaying ? (
                                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                                                ) : (
                                                    <svg className="w-4 h-4 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                                )}
                                            </button>
                                            <span className="text-[10px] font-black text-gray-400 uppercase px-4">{elapsedTime.toFixed(1)}s / {totalSlideshowDuration.toFixed(1)}s</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <button onClick={() => setElapsedTime(0)} className="text-[10px] font-black uppercase text-gray-500 hover:text-white transition-colors">Reset Cursor</button>
                                    </div>
                                </div>
                                <StudioTimeline />
                            </section>
                            <div className="grid md:grid-cols-2 gap-8">
                                <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-white/5">
                                    <h3 className="text-xs font-black uppercase mb-6 text-brand-purple tracking-widest">Sound Effects Library</h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        {SFX_OPTIONS.map(sfx => (
                                            <button key={sfx.name} onClick={() => addSFX(sfx)} className="bg-gray-900/60 p-4 rounded-2xl text-[10px] font-black uppercase border border-white/5 hover:border-brand-purple transition-all flex justify-between group active:scale-95">
                                                {sfx.name} <span className="opacity-0 group-hover:opacity-100 text-brand-purple">＋ Add</span>
                                            </button>
                                        ))}
                                    </div>
                                </section>
                                <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-white/5">
                                    <h3 className="text-xs font-black uppercase mb-6 text-brand-purple tracking-widest">Video Master Mix</h3>
                                    <div className="space-y-4">
                                        {mediaFiles.filter(m => m.type === 'video').map(m => (
                                            <div key={m.id} className="flex items-center gap-4 bg-gray-900/60 p-4 rounded-2xl border border-white/5">
                                                <div className="w-16 h-12 bg-gray-800 rounded-lg overflow-hidden border border-white/5">
                                                    <img src={m.previewUrl} className="w-full h-full object-cover" alt="" />
                                                </div>
                                                <div className="flex-1 space-y-2">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-tighter">Volume Profile</span>
                                                        <button onClick={() => toggleMuteMedia(m.id)} className={`text-[8px] font-black p-1 px-3 rounded-full transition-all ${m.isMuted ? 'bg-red-500/20 text-red-500 border border-red-500/40' : 'bg-brand-purple/20 text-brand-purple border border-brand-purple/40'}`}>
                                                            {m.isMuted ? 'MUTED' : 'ON AIR'}
                                                        </button>
                                                    </div>
                                                    <input type="range" min="0" max="1" step="0.01" value={m.isMuted ? 0 : (m.videoVolume ?? 1)} onChange={(e) => setMediaFiles(p => p.map(x => x.id === m.id ? {...x, videoVolume: parseFloat(e.target.value), isMuted: parseFloat(e.target.value) === 0} : x))} className="w-full accent-brand-purple h-1 bg-gray-700 rounded-full cursor-pointer" />
                                                </div>
                                            </div>
                                        ))}
                                        {mediaFiles.filter(m => m.type === 'video').length === 0 && (
                                            <div className="text-center py-12 opacity-10 flex flex-col items-center gap-4">
                                                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                                                <p className="text-[10px] font-black uppercase tracking-widest">No Video Layers Found</p>
                                            </div>
                                        )}
                                    </div>
                                </section>
                            </div>
                        </div>
                    ) : (
                        <div className="grid md:grid-cols-12 gap-8 animate-fade-in">
                            <div className="md:col-span-4 space-y-6">
                                <section className="bg-gray-800/30 p-6 rounded-3xl border border-white/5 shadow-xl">
                                    <h3 className="text-xs font-black uppercase mb-4 text-brand-purple tracking-widest">Visual Assets (Max 20)</h3>
                                    <div className="grid grid-cols-4 gap-2 mb-4">
                                        <div className="aspect-square bg-gray-900/50 rounded-xl border-2 border-dashed border-white/10 flex items-center justify-center relative hover:border-brand-purple hover:bg-brand-purple/5 cursor-pointer group transition-all">
                                            <input type="file" multiple accept="image/*,video/*" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                            <span className="text-2xl text-gray-600 group-hover:text-brand-purple transition-colors">＋</span>
                                        </div>
                                        {mediaFiles.map((m, idx) => (
                                            <div key={m.id} className="aspect-square bg-gray-900 rounded-xl overflow-hidden relative border border-white/5 group shadow-lg">
                                                <img src={m.previewUrl} className="w-full h-full object-cover transition-transform group-hover:scale-110" alt="" />
                                                <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-1">
                                                    <div className="flex gap-1">
                                                        <button onClick={() => moveMedia(idx, 'up')} className="bg-white/10 hover:bg-white/30 p-1.5 rounded-lg text-xs">←</button>
                                                        <button onClick={() => moveMedia(idx, 'down')} className="bg-white/10 hover:bg-white/30 p-1.5 rounded-lg text-xs">→</button>
                                                    </div>
                                                    <button onClick={() => setMediaFiles(p => p.filter(x => x.id !== m.id))} className="bg-red-600/80 hover:bg-red-600 text-white p-1.5 rounded-lg text-xs">✕</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <button onClick={generateSmartCaptions} disabled={isProcessingCaptions} className="w-full bg-brand-purple/10 text-brand-purple py-3 rounded-2xl text-[10px] font-black uppercase border border-brand-purple/20 hover:bg-brand-purple hover:text-white transition-all">
                                        {isProcessingCaptions ? 'AI is writing...' : '✨ Auto-Captions'}
                                    </button>
                                </section>

                                <section className="bg-gray-800/30 p-6 rounded-3xl border border-white/5 shadow-xl">
                                    <h3 className="text-xs font-black uppercase mb-4 text-brand-purple tracking-widest">Master Soundtrack</h3>
                                    <div className="grid grid-cols-2 gap-2 mb-4">
                                        <div className="relative">
                                            <button className="w-full bg-gray-800 border border-white/5 py-3 rounded-xl text-[10px] font-black uppercase text-gray-500 hover:text-white transition-colors">Local File</button>
                                            <input type="file" accept="audio/*" onChange={handleAudioUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                                        </div>
                                        <button onClick={() => setIsMusicBrowserOpen(true)} className="w-full bg-apple-red/10 py-3 rounded-xl text-[10px] font-black uppercase text-apple-red border border-apple-red/20 hover:bg-apple-red hover:text-white transition-colors">Apple Music</button>
                                    </div>
                                    <div className="space-y-2">
                                        {audioFiles.length > 0 ? audioFiles.map(a => (
                                            <div key={a.id} className="bg-black/20 p-3 rounded-xl text-[10px] flex justify-between items-center border border-white/5">
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <span className="w-2 h-2 rounded-full bg-brand-purple animate-pulse"></span>
                                                    <span className="truncate font-bold text-gray-300">{a.name}</span>
                                                </div>
                                                <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))} className="text-gray-600 hover:text-red-500 transition-colors">🗑️</button>
                                            </div>
                                        )) : (
                                            <p className="text-[10px] text-gray-700 text-center py-4 font-black uppercase tracking-widest italic">No Audio Layers</p>
                                        )}
                                    </div>
                                </section>

                                <section className="bg-gray-800/30 p-6 rounded-3xl border border-white/5 shadow-xl">
                                    <h3 className="text-xs font-black uppercase mb-4 text-brand-purple tracking-widest">Motion Styles</h3>
                                    <div className="grid grid-cols-2 gap-2 mb-4">
                                        {['ken-burns', 'fade-in', 'slide-from-right', 'zoom-in'].map(style => (
                                            <button key={style} onClick={() => setSettings(s => ({...s, slideStyle: style}))} className={`py-3 rounded-xl text-[10px] font-black uppercase border transition-all ${settings.slideStyle === style ? 'bg-brand-purple text-white shadow-lg border-brand-purple' : 'bg-gray-800 border-white/5 text-gray-500 hover:border-white/10'}`}>
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
                                <section className="bg-gray-800/30 p-8 rounded-[3.5rem] border border-white/5 shadow-2xl">
                                    <div className="aspect-video bg-gray-950 rounded-[3rem] relative overflow-hidden border border-white/10 flex items-center justify-center group">
                                        {mediaFiles.length > 0 ? (
                                            <div className="w-full h-full relative">
                                                <img src={mediaFiles[0].previewUrl} className="w-full h-full object-cover opacity-20 blur-md scale-110" alt="" />
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="w-24 h-24 bg-brand-purple rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(109,40,217,0.5)] hover:scale-110 active:scale-95 transition-all">
                                                        <svg className="w-10 h-10 text-white ml-2" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-center p-12 opacity-10 flex flex-col items-center">
                                                <div className="w-24 h-24 bg-gray-900 border border-white/10 rounded-[2.5rem] flex items-center justify-center mx-auto mb-6 text-4xl shadow-2xl">🎬</div>
                                                <p className="text-xs font-black uppercase tracking-[0.3em]">Timeline Empty</p>
                                            </div>
                                        )}
                                    </div>
                                </section>

                                <section className="space-y-6">
                                    <div className="flex justify-between items-center px-4">
                                        <h3 className="text-xs font-black uppercase text-gray-500 tracking-widest">Saved Collections</h3>
                                        <div className="h-px bg-white/5 flex-1 mx-6"></div>
                                    </div>
                                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {ownedSlideshows.map(ss => (
                                            <div key={ss.id} className="bg-gray-800/20 p-6 rounded-[2.5rem] border border-white/5 hover:border-brand-purple transition-all group shadow-xl">
                                                <div className="aspect-square bg-gray-900 rounded-[2rem] mb-5 overflow-hidden relative border border-white/5">
                                                    {ss.media[0] && <img src={ss.media[0].previewUrl} className="w-full h-full object-cover opacity-40 group-hover:scale-105 transition-transform" alt="" />}
                                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60">
                                                        <button onClick={() => loadProject(ss)} className="bg-white text-brand-dark px-6 py-2.5 rounded-full font-black text-xs uppercase tracking-widest shadow-2xl">Open</button>
                                                    </div>
                                                </div>
                                                <h4 className="font-bold truncate text-sm mb-1 text-gray-200">{ss.name}</h4>
                                                <div className="flex gap-2 mt-4">
                                                    <button onClick={() => loadProject(ss)} className="flex-1 bg-brand-purple/10 text-brand-purple py-2 rounded-xl text-[10px] font-black uppercase hover:bg-brand-purple hover:text-white transition-colors">Load</button>
                                                    <button onClick={() => shareProject(ss.id)} className="flex-1 bg-white/5 text-gray-400 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-white/10 transition-colors">Share</button>
                                                    <button onClick={() => deleteSlideshow(ss.id)} className="p-2 text-red-500/50 hover:text-red-500 transition-colors">🗑️</button>
                                                </div>
                                            </div>
                                        ))}
                                        {ownedSlideshows.length === 0 && (
                                            <div className="col-span-full py-24 text-center opacity-10 border-2 border-dashed border-white/5 rounded-[3rem]">
                                                <p className="text-[10px] font-black uppercase tracking-[0.3em]">No Projects Found</p>
                                            </div>
                                        )}
                                    </div>
                                </section>
                            </div>
                        </div>
                    )}
                </main>
            )}

            {/* MODALS */}
            {isMusicBrowserOpen && (
                <div className="fixed inset-0 bg-black/98 z-[500] flex items-center justify-center p-6 backdrop-blur-3xl animate-fade-in">
                    <div className="bg-gray-950 w-full max-w-2xl h-[80vh] rounded-[4rem] border border-white/10 p-12 flex flex-col shadow-[0_0_100px_rgba(0,0,0,1)]">
                        <div className="flex justify-between items-center mb-12">
                            <h2 className="text-3xl font-black uppercase tracking-tighter text-white">Music Vault</h2>
                            <button onClick={() => setIsMusicBrowserOpen(false)} className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center text-gray-500 hover:text-white transition-all border border-white/5">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
                            {!appleMusicAuthorized && !isSimulationMode ? (
                                <div className="text-center py-24 bg-white/5 rounded-[4rem] border border-white/5">
                                    <div className="w-24 h-24 bg-apple-red/10 text-apple-red rounded-[2.5rem] flex items-center justify-center mx-auto mb-10 text-4xl shadow-2xl"></div>
                                    <h3 className="text-2xl font-black mb-4 text-white uppercase tracking-tight">Connect Library</h3>
                                    <button onClick={() => setIsSimulationMode(true)} className="bg-apple-red text-white px-16 py-5 rounded-full font-black shadow-[0_15px_30px_rgba(250,36,60,0.3)] text-xs uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-all">Browse Simulation</button>
                                </div>
                            ) : (
                                <div className="grid gap-4">
                                    {MOCK_TRACKS.map(track => (
                                        <div key={track.id} className="bg-white/5 p-6 rounded-[2.5rem] border border-white/5 flex justify-between items-center hover:bg-white/10 hover:border-brand-purple cursor-pointer transition-all group" onClick={() => { setAudioFiles(p => [...p, { ...track, startTime: elapsedTime }]); setIsMusicBrowserOpen(false); }}>
                                            <div className="flex items-center gap-5">
                                                <div className="w-14 h-14 bg-gray-900 rounded-2xl flex items-center justify-center text-xl shadow-inner group-hover:bg-brand-purple/20 transition-colors">🎵</div>
                                                <div className="flex flex-col">
                                                    <span className="font-black text-white text-base tracking-tight">{track.name}</span>
                                                    <span className="text-[10px] text-gray-600 uppercase font-black tracking-widest">{Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2,'0')}</span>
                                                </div>
                                            </div>
                                            <button className="bg-brand-purple/20 text-brand-purple px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest group-hover:bg-brand-purple group-hover:text-white transition-all">Add to Mix</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {isPlaying && viewMode !== 'studio' && (
                <div className="fixed inset-0 bg-black z-[600] flex flex-col items-center justify-center animate-fade-in">
                    <button onClick={() => setIsPlaying(false)} className="absolute top-10 right-10 text-white/20 hover:text-white p-5 z-[610] text-4xl transition-all cursor-pointer">✕</button>
                    <div className="w-full h-full relative overflow-hidden flex items-center justify-center">
                        {mediaWithTimestamps.map((m, idx) => (
                            <TheaterMedia key={m.id} media={m} isVisible={idx === currentSlide} slideStyle={settings.slideStyle} showCaptions={settings.showCaptions} />
                        ))}
                    </div>
                    <div className="absolute bottom-0 left-0 h-1.5 bg-brand-purple z-[620] transition-all duration-200 shadow-[0_0_30px_rgba(109,40,217,1)]" style={{ width: `${(elapsedTime / totalSlideshowDuration) * 100}%` }}></div>
                </div>
            )}
            
            {error && (
                <div className="fixed bottom-10 right-10 bg-red-600 text-white p-8 rounded-[2.5rem] shadow-2xl z-[700] flex gap-8 items-center border border-white/20 animate-slide-from-bottom">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase opacity-60 tracking-widest">System Alert</span>
                        <p className="text-sm font-bold tracking-tight">{error}</p>
                    </div>
                    <button onClick={() => setError(null)} className="p-3 bg-white/20 hover:bg-white/40 rounded-full transition-all text-xs">✕</button>
                </div>
            )}
        </div>
    );
};

export default App;
