
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
  appId: "1:1034458390234:web:e0585b9aad338501797ec", // Updated AppID
  measurementId: "G-SKRCL4J4GD"
};

// --- FIREBASE INITIALIZATION ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// --- TYPE DEFINITIONS ---
interface Collaborator {
    email: string;
    role: 'viewer' | 'editor';
}

interface ImageFile {
  id: string;
  type: 'image';
  file?: File;
  previewUrl: string;
  caption: string;
  aiCaption?: string;
  rotation: number;
  serverData?: { url: string; storagePath: string; };
}

interface VideoFile {
    id:string;
    type: 'video';
    file?: File;
    previewUrl: string;
    rotation: number;
    duration?: number; 
    volume: number; // 0 to 1
    duckBGM: boolean;
    serverData?: { url: string; storagePath: string; };
}

type MediaFile = ImageFile | VideoFile;

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
    serverData?: { url: string; storagePath: string; };
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
    userEmail?: string;
    name: string;
    media: any[];
    audio: any[];
    settings: SlideshowSettings;
    timestamp?: any; 
    createdAt?: any; 
    totalDuration?: number;
    collaboratorEmails?: string[];
}

interface AppleMusicPlaylist {
    id: string;
    attributes: {
        name: string;
        artwork?: { url: string };
    };
}

interface AppleMusicTrack {
    id: string;
    attributes: {
        name: string;
        artistName: string;
        durationInMillis: number;
        artwork?: { url: string };
        previewAssets?: Array<{ url: string }>;
    };
}

// --- HELPER FUNCTIONS ---
const getMediaDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
        const objectUrl = URL.createObjectURL(file);
        const element = file.type.startsWith('audio') ? new Audio(objectUrl) : document.createElement('video');
        const cleanup = () => URL.revokeObjectURL(objectUrl);
        if (file.type.startsWith('video')) {
            const videoEl = element as HTMLVideoElement;
            videoEl.preload = 'metadata';
            videoEl.src = objectUrl;
            videoEl.onloadedmetadata = () => { resolve(videoEl.duration || 0); cleanup(); };
            videoEl.onerror = () => { resolve(0); cleanup(); };
        } else {
            const audioEl = element as HTMLAudioElement;
            audioEl.onloadedmetadata = () => { resolve(audioEl.duration || 0); cleanup(); };
            audioEl.onerror = () => { resolve(0); cleanup(); };
        }
    });
};

const formatDuration = (seconds: number) => {
    const totalSecs = Math.max(0, Math.round(seconds || 0));
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const getMillis = (val: any): number => {
    if (!val) return 0;
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'number') return val;
    return Date.now(); 
};

// --- APPLE MUSIC PLAYER COMPONENT ---
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
            } else {
                if (!audio.paused) audio.pause();
            }
            return;
        }

        const music = (window as any).MusicKit?.getInstance();
        if (!music || isDemo) return;

        const handlePlayback = async () => {
            if (active) {
                try {
                    if (music.nowPlayingItem?.id !== trackId) await music.setQueue({ song: trackId });
                    if (music.playbackState !== 2) await music.play();
                    if (Math.abs(music.currentPlaybackTime - startTimeInFile) > 1.0) await music.seekToTime(startTimeInFile);
                } catch (e) { console.error("Apple Music Playback Error", e); }
            } else {
                if (music.nowPlayingItem?.id === trackId && music.playbackState === 2) music.pause();
            }
        };
        handlePlayback();
    }, [active, trackId, startTimeInFile, isDemo, demoAudioUrl]);

    useEffect(() => {
        const audio = isDemo ? audioRef.current : (window as any).MusicKit?.getInstance();
        if (!audio) return;
        const target = isDemo ? (audio as HTMLAudioElement) : (audio as any);
        if (Math.abs(lastVolumeRef.current - volume) > 0.01) {
            target.volume = Math.max(0, Math.min(1, volume));
            lastVolumeRef.current = volume;
        }
    }, [volume, isDemo]);

    return isDemo && demoAudioUrl ? <audio ref={audioRef} src={demoAudioUrl} preload="auto" /> : null;
};

// --- THEATER MEDIA COMPONENT ---
const TheaterMedia: React.FC<{
    media: MediaFile;
    isVisible: boolean;
    isPreloading: boolean;
    muteVideos: boolean;
    elapsedTime: number;
    slideStyle: string;
}> = ({ media, isVisible, isPreloading, muteVideos, elapsedTime, slideStyle }) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || media.type !== 'video') return;
        if (isVisible) {
            video.muted = muteVideos;
            video.volume = muteVideos ? 0 : ((media as VideoFile).volume || 1.0);
            const offset = elapsedTime - (media as any).timelineStart;
            if (offset >= 0 && offset < (media as any).duration) {
                video.currentTime = offset;
                video.play().catch(err => console.error("Playback failed:", err));
            } else if (offset >= (media as any).duration) video.pause();
        } else {
            video.pause();
            if (isPreloading) { video.currentTime = 0; video.load(); }
        }
    }, [isVisible, isPreloading, muteVideos, (media as any).timelineStart, (media as any).duration]);

    return (
        <div className={`w-full h-full absolute inset-0 flex items-center justify-center transition-opacity duration-700 ${isVisible ? 'opacity-100 z-20' : 'opacity-0 z-10'}`}>
            <div className={`w-full h-full flex items-center justify-center animate-${isVisible ? slideStyle : 'none'}`}>
                {media.type === 'image' ? (
                    <img src={media.previewUrl} className="w-full h-full object-contain" alt="slide" />
                ) : (
                    <video ref={videoRef} src={media.previewUrl} className="w-full h-full object-contain shadow-2xl" playsInline preload="auto" loop={false} />
                )}
            </div>
        </div>
    );
};

// --- AUDIO PLAYER COMPONENT ---
const AudioPlayer: React.FC<{
    src: string;
    active: boolean;
    volume: number;
    startTimeInFile: number;
}> = ({ src, active, volume, startTimeInFile }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const lastVolumeRef = useRef(volume);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (active) {
            if (audio.paused) audio.play().catch(() => {});
            if (Math.abs(audio.currentTime - startTimeInFile) > 0.5) audio.currentTime = startTimeInFile;
        } else { if (!audio.paused) audio.pause(); }
    }, [active, startTimeInFile]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (Math.abs(lastVolumeRef.current - volume) > 0.01) {
            audio.volume = Math.max(0, Math.min(1, volume));
            lastVolumeRef.current = volume;
        }
    }, [volume]);

    return <audio ref={audioRef} src={src} preload="auto" />;
};

// --- ICONS ---
const UploadIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>;
const MusicIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-13c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>;
const AppleIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="currentColor" viewBox="0 0 384 512"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>;
const PlayIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const XIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
const PlusIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>;
const TrashIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>;
const SettingsIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

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
    const [currentSlideshowId, setCurrentSlideshowId] = useState<string | null>(null);
    const [ownedSlideshows, setOwnedSlideshows] = useState<SavedSlideshow[]>([]);
    const [sharedWithMeSlideshows, setSharedWithMeSlideshows] = useState<SavedSlideshow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isAdvancedEditorOpen, setIsAdvancedEditorOpen] = useState(false);
    
    // --- APPLE MUSIC ---
    const [isMusicBrowserOpen, setIsMusicBrowserOpen] = useState(false);
    const [appleMusicAuthorized, setAppleMusicAuthorized] = useState(false);
    const [isDemoMode, setIsDemoMode] = useState(false);
    const [developerToken, setDeveloperToken] = useState('APPLE_MUSIC_DEVELOPER_TOKEN');
    const [showTokenSettings, setShowTokenSettings] = useState(false);
    const [appleMusicPlaylists, setAppleMusicPlaylists] = useState<AppleMusicPlaylist[]>([]);
    const [appleMusicTracks, setAppleMusicTracks] = useState<AppleMusicTrack[]>([]);
    const [selectedApplePlaylist, setSelectedApplePlaylist] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const requestRef = useRef<number>(0);
    const startTimeRef = useRef<number>(0);
    const lastTickTimeRef = useRef<number>(0);

    const configureMusicKit = async (token: string) => {
        if (!(window as any).MusicKit) return false;
        // DEFENSIVE: Prevent "Invalid token" error noise by only calling configure with real tokens
        if (token === 'APPLE_MUSIC_DEVELOPER_TOKEN' || !token.startsWith('eyJ')) {
            return false;
        }
        try {
            const music = await (window as any).MusicKit.configure({
                developerToken: token,
                app: { name: 'Muziq Slides', build: '1.0.2' }
            });
            return music.isAuthorized;
        } catch (e) {
            console.warn("Apple MusicKit config skipped (Expected without valid production token).");
            return false;
        }
    };

    useEffect(() => {
        configureMusicKit(developerToken).then(setAppleMusicAuthorized);
    }, []);

    const authorizeAppleMusic = async () => {
        setError(null);
        // Fallback to Demo Mode if the token is not production-ready
        if (developerToken === 'APPLE_MUSIC_DEVELOPER_TOKEN' || !developerToken.startsWith('eyJ')) {
            setIsProcessing(true);
            setTimeout(() => {
                setIsDemoMode(true); 
                setAppleMusicAuthorized(true);
                setAppleMusicPlaylists([
                    { id: 'p1', attributes: { name: 'Demo: Summer Classics', artwork: { url: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=200&h=200&fit=crop' } } },
                    { id: 'p2', attributes: { name: 'Demo: Chill Study Beats', artwork: { url: 'https://images.unsplash.com/photo-1459749411177-042180ce673c?w=200&h=200&fit=crop' } } },
                ]);
                setIsProcessing(false);
            }, 600);
            return;
        }
        
        const music = (window as any).MusicKit?.getInstance();
        if (!music) { setError("MusicKit not initialized. Enter a valid token in settings."); return; }
        try {
            await music.authorize(); 
            setAppleMusicAuthorized(true); 
            fetchApplePlaylists();
        } catch (e: any) { setError(`Auth failed: ${e.message}`); }
    };

    const fetchApplePlaylists = async () => {
        if (isDemoMode) return;
        const music = (window as any).MusicKit?.getInstance();
        if (!music || !music.isAuthorized) return;
        try {
            const playlists = await music.api.library.playlists();
            setAppleMusicPlaylists(playlists || []);
        } catch (e) { setError("Failed to fetch library playlists."); }
    };

    const fetchAppleTracks = async (playlistId: string) => {
        setSelectedApplePlaylist(playlistId);
        if (isDemoMode) {
            setAppleMusicTracks([
                { id: 't1', attributes: { name: 'Lofi Horizons (Mock)', artistName: 'Muziq Demo', durationInMillis: 180000, artwork: { url: 'https://images.unsplash.com/photo-1514525253344-f2501065c711?w=100&h=100&fit=crop' }, previewAssets: [{ url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' }] } },
                { id: 't2', attributes: { name: 'Acoustic Dreams (Mock)', artistName: 'Muziq Demo', durationInMillis: 215000, artwork: { url: 'https://images.unsplash.com/photo-1496293455970-f8581aae0e3c?w=100&h=100&fit=crop' }, previewAssets: [{ url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' }] } },
            ]);
            return;
        }
        const music = (window as any).MusicKit?.getInstance();
        if (!music || !music.isAuthorized) return;
        try {
            const playlist = await music.api.library.playlist(playlistId);
            setAppleMusicTracks(playlist.relationships.tracks.data || []);
        } catch (e) { setError("Failed to fetch tracks."); }
    };

    const addAppleMusicTrack = (track: AppleMusicTrack) => {
        setAudioFiles(p => [...p, {
            id: `am-${track.id}-${Date.now()}`,
            name: track.attributes.name,
            duration: track.attributes.durationInMillis / 1000,
            startTime: 0, fadeIn: 1, fadeOut: 1,
            previewUrl: track.attributes.artwork?.url.replace('{w}', '100').replace('{h}', '100') || '',
            source: 'apple-music',
            appleMusicTrackId: track.id,
            demoAudioUrl: isDemoMode ? track.attributes.previewAssets?.[0]?.url : undefined
        }]);
    };

    const handleUpdateToken = async () => {
        setIsProcessing(true); setError(null);
        const authorized = await configureMusicKit(developerToken);
        setAppleMusicAuthorized(authorized);
        setIsDemoMode(!authorized);
        setIsProcessing(false);
        if (authorized) {
            setShowTokenSettings(false);
            fetchApplePlaylists();
        } else {
            setError("The token provided is invalid. Please ensure it is a signed JWT from Apple.");
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => { 
            setUser(u); 
            if (!u) resetWorkspace();
            setIsLoading(false); 
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        if (!user) return;
        const qOwned = query(collection(db, "slideshows"), where("userId", "==", user.uid));
        const unsubOwned = onSnapshot(qOwned, (snap) => {
            setOwnedSlideshows(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow)));
        });
        return unsubOwned;
    }, [user]);

    const allSlideshows = useMemo(() => {
        return [...ownedSlideshows].sort((a, b) => (getMillis(b.timestamp) || 0) - (getMillis(a.timestamp) || 0));
    }, [ownedSlideshows]);

    const mediaWithTimestamps = useMemo(() => {
        let currentPos = 0;
        return mediaFiles.map(m => {
            const start = currentPos;
            const dur = m.type === 'image' ? settings.interval : (m.duration || 0);
            currentPos += dur;
            return { ...m, timelineStart: start, timelineEnd: currentPos };
        });
    }, [mediaFiles, settings.interval]);

    const totalSlideshowDuration = useMemo(() => {
        return mediaWithTimestamps.length > 0 ? mediaWithTimestamps[mediaWithTimestamps.length - 1].timelineEnd : 0;
    }, [mediaWithTimestamps]);

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
        if (isPlaying) { startTimeRef.current = 0; lastTickTimeRef.current = performance.now(); requestRef.current = requestAnimationFrame(animate); }
        else cancelAnimationFrame(requestRef.current);
        return () => cancelAnimationFrame(requestRef.current);
    }, [isPlaying, animate]);

    useEffect(() => {
        const activeIdx = mediaWithTimestamps.findIndex(m => elapsedTime >= m.timelineStart && elapsedTime < m.timelineEnd);
        if (activeIdx !== -1 && activeIdx !== currentSlide) setCurrentSlide(activeIdx);
    }, [elapsedTime, mediaWithTimestamps, currentSlide]);

    const resetWorkspace = () => {
        setMediaFiles([]); setAudioFiles([]); setSlideshowName(''); setCurrentSlideshowId(null); setElapsedTime(0); setIsPlaying(false);
    };

    const handleLogin = async () => {
        const provider = new GoogleAuthProvider();
        try { await signInWithPopup(auth, provider); } catch (e: any) { setError("Sign in failed."); }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const files = Array.from(e.target.files).slice(0, 20 - mediaFiles.length);
        const resolved: MediaFile[] = [];
        for (const f of files) {
            const isImg = f.type.startsWith('image/');
            const dur = isImg ? 0 : await getMediaDuration(f);
            resolved.push({ id: `m-${Math.random().toString(36).substr(2, 9)}`, file: f, previewUrl: URL.createObjectURL(f), type: isImg ? 'image' : 'video', rotation: 0, caption: '', duration: dur, volume: 1.0, duckBGM: true } as MediaFile);
        }
        setMediaFiles(p => [...p, ...resolved]);
    };

    const handleAudioChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0]) return;
        const file = e.target.files[0];
        const duration = await getMediaDuration(file);
        setAudioFiles(p => [...p, { id: `a-${Date.now()}`, file, name: file.name, duration, startTime: 0, fadeIn: 1, fadeOut: 1, source: 'local', previewUrl: URL.createObjectURL(file) }]);
    };

    // FIXED: Properly save media and audio arrays while stripping File objects which cannot be stored in Firestore
    const handleSave = async () => {
        if (!user || !mediaFiles.length) return;
        setIsSaving(true); setError(null);
        try {
            const id = currentSlideshowId || doc(collection(db, 'slideshows')).id;
            await setDoc(doc(db, 'slideshows', id), { 
                userId: user.uid, 
                userEmail: user.email, 
                name: slideshowName || 'My Slideshow', 
                settings, 
                media: mediaFiles.map(m => {
                    const { file, ...rest } = m;
                    return rest;
                }),
                audio: audioFiles.map(a => {
                    const { file, ...rest } = a;
                    return rest;
                }),
                totalDuration: totalSlideshowDuration, 
                timestamp: serverTimestamp() 
            }, { merge: true });
            setCurrentSlideshowId(id);
        } catch (e: any) { setError("Save failed."); } finally { setIsSaving(false); }
    };

    // FIXED: Correctly load saved media and audio data back into state using explicit type casting to avoid 'unknown' errors
    const handleLoad = (s: SavedSlideshow) => {
        setSlideshowName(s.name);
        setSettings(s.settings);
        setCurrentSlideshowId(s.id);
        setMediaFiles((s.media as any[]) || []);
        setAudioFiles((s.audio as any[]) || []);
        setError(null);
    };

    if (isLoading) return <div className="min-h-screen bg-brand-dark flex items-center justify-center"><div className="w-10 h-10 border-2 border-brand-purple border-t-transparent rounded-full animate-spin"></div></div>;

    return (
        <div className={`min-h-screen font-sans ${user ? 'bg-brand-dark text-gray-200' : 'bg-white text-gray-900'}`}>
            {(isSaving || isProcessing) && <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center backdrop-blur-sm"><div className="w-10 h-10 border-2 border-brand-purple border-t-transparent rounded-full animate-spin"></div></div>}

            <header className="p-4 flex justify-between items-center border-b border-gray-800 backdrop-blur-md bg-gray-900/50 sticky top-0 z-40">
                <h1 className="text-xl font-bold tracking-tight text-white"><span className="text-brand-purple">Muziq</span> Slides</h1>
                <div>
                    {user ? <button onClick={() => signOut(auth)} className="text-xs bg-brand-purple px-4 py-2 rounded-lg font-bold">Logout</button> : <button onClick={handleLogin} className="text-xs bg-brand-purple px-4 py-2 rounded-lg font-bold text-white">Sign In</button>}
                </div>
            </header>

            {!user ? (
                <main className="text-center pt-20 px-4">
                    <h2 className="text-4xl font-extrabold mb-4">Your Library, Your <span className="text-brand-purple">Slides</span></h2>
                    <p className="text-gray-500 mb-8">Sign in to start creating beautiful photo stories with your Apple Music library.</p>
                    <button onClick={handleLogin} className="bg-brand-purple text-white px-8 py-3 rounded-full font-bold shadow-lg">Get Started</button>
                </main>
            ) : (
                <main className="p-4 max-w-6xl mx-auto grid lg:grid-cols-2 gap-8">
                    <div className="space-y-6">
                        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 p-4 rounded-xl text-xs flex justify-between items-center"><span>{error}</span><button onClick={() => setError(null)}><XIcon className="w-4 h-4"/></button></div>}

                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-sm font-bold uppercase mb-4 flex items-center gap-2"><UploadIcon className="w-4 h-4 text-brand-purple"/> 1. Upload Assets</h3>
                            <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-gray-700 rounded-2xl p-8 text-center cursor-pointer hover:border-brand-purple transition-all">
                                <UploadIcon className="w-8 h-8 mx-auto text-gray-600 mb-2"/>
                                <p className="text-xs text-gray-500 font-bold">Upload Photos or Videos</p>
                            </div>
                            <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept="image/*,video/*" className="hidden" />
                            <div className="mt-4 grid grid-cols-5 gap-2">
                                {mediaFiles.map((m, idx) => (
                                    <div key={m.id} className="aspect-square bg-black rounded-lg overflow-hidden relative group">
                                        <img src={m.previewUrl} className="w-full h-full object-cover" alt="thumb" />
                                        <button onClick={() => setMediaFiles(p => p.filter(x => x.id !== m.id))} className="absolute top-1 right-1 bg-red-500/80 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"><XIcon className="w-3 h-3 text-white"/></button>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-sm font-bold uppercase mb-4 flex items-center gap-2"><MusicIcon className="w-4 h-4 text-brand-purple"/> 2. Choose Music</h3>
                            <div className="grid grid-cols-2 gap-3">
                                <button onClick={() => audioInputRef.current?.click()} className="bg-gray-700/50 py-3 rounded-xl text-[10px] font-bold uppercase border border-gray-600">Local MP3</button>
                                <button onClick={() => { setIsMusicBrowserOpen(true); if (appleMusicAuthorized && !isDemoMode) fetchApplePlaylists(); }} className="bg-apple-red/10 py-3 rounded-xl text-[10px] font-bold uppercase border border-apple-red/30 text-apple-red">Apple Music</button>
                            </div>
                            <input type="file" ref={audioInputRef} onChange={handleAudioChange} accept="audio/*" className="hidden" />
                            <div className="mt-4 space-y-2">
                                {audioFiles.map(a => (
                                    <div key={a.id} className="bg-gray-950/50 p-3 rounded-xl flex justify-between items-center text-[10px] font-bold">
                                        <div className="flex items-center gap-2">
                                            {a.source === 'apple-music' ? <AppleIcon className="w-3 h-3 text-apple-red"/> : <MusicIcon className="w-3 h-3 text-gray-500"/>}
                                            <span className="truncate max-w-[120px]">{a.name}</span>
                                        </div>
                                        <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))}><TrashIcon className="w-3 h-3 text-red-500"/></button>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </div>

                    <div className="space-y-6">
                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <div className="flex justify-between items-center mb-4"><h3 className="text-sm font-bold uppercase">3. Preview</h3><button onClick={() => setIsAdvancedEditorOpen(true)} className="text-[10px] bg-brand-purple/20 text-brand-purple px-3 py-1.5 rounded-lg border border-brand-purple/30 font-bold uppercase">Timeline</button></div>
                            <div className="aspect-video bg-black rounded-2xl relative overflow-hidden flex items-center justify-center border border-gray-700/50">
                                {mediaFiles.length > 0 ? <button onClick={() => { setElapsedTime(0); setIsPlaying(true); }} className="bg-brand-purple p-6 rounded-full shadow-xl"><PlayIcon className="w-10 h-10 text-white"/></button> : <span className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">No Content</span>}
                            </div>
                        </section>

                        <section className="bg-gray-800/30 p-6 rounded-3xl border border-gray-700/50">
                            <h3 className="text-sm font-bold uppercase mb-4">4. Save Project</h3>
                            <div className="flex gap-2">
                                <input value={slideshowName} onChange={e => setSlideshowName(e.target.value)} placeholder="Project Name..." className="flex-1 bg-black/30 rounded-xl px-4 py-3 text-xs border border-gray-700 outline-none" />
                                <button onClick={handleSave} disabled={isSaving} className="bg-brand-purple px-6 py-3 rounded-xl text-xs font-bold uppercase">{isSaving ? '...' : 'Save'}</button>
                            </div>
                            <div className="mt-6 space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar">
                                {allSlideshows.map(s => (
                                    <div key={s.id} className="bg-gray-900/50 p-3 rounded-xl flex justify-between items-center border border-gray-800 group">
                                        <div className="min-w-0"><p className="text-[10px] font-bold text-white truncate">{s.name}</p><p className="text-[8px] text-gray-600 uppercase">{formatDuration(s.totalDuration || 0)}</p></div>
                                        <button onClick={() => handleLoad(s)} className="text-[8px] bg-white text-black px-3 py-1 rounded font-black uppercase opacity-0 group-hover:opacity-100 transition-opacity">Load</button>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </div>
                </main>
            )}

            {/* MUSIC BROWSER */}
            {isMusicBrowserOpen && (
                <div className="fixed inset-0 bg-black/95 z-[200] flex items-center justify-center p-4">
                    <div className="bg-gray-900 w-full max-w-3xl h-[80vh] rounded-[2rem] border border-gray-800 shadow-2xl flex flex-col overflow-hidden">
                        <header className="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-950/50">
                            <div className="flex items-center gap-3"><AppleIcon className="w-6 h-6 text-apple-red"/><h2 className="font-bold uppercase tracking-tight">Apple Music Library</h2></div>
                            <div className="flex gap-3"><button onClick={() => setShowTokenSettings(!showTokenSettings)} className="text-[9px] font-bold text-gray-500 hover:text-white uppercase">Integration Settings</button><button onClick={() => setIsMusicBrowserOpen(false)}><XIcon className="w-6 h-6 text-gray-500"/></button></div>
                        </header>

                        {showTokenSettings ? (
                            <div className="flex-1 p-8 overflow-y-auto">
                                <h3 className="text-sm font-bold uppercase mb-2">Setup Real Music Production</h3>
                                <p className="text-[10px] text-gray-500 mb-6 leading-relaxed">Paste your Apple Developer Token (JWT) here to access your personal playlists. <br/> Without a token, the app runs in <strong>Demo Mode</strong> using sample audio.</p>
                                <textarea value={developerToken} onChange={e => setDeveloperToken(e.target.value)} placeholder="Bearer eyJhb..." className="w-full h-32 bg-black/40 border border-gray-800 rounded-xl p-4 font-mono text-[10px] text-brand-light outline-none focus:ring-1 focus:ring-apple-red" />
                                <button onClick={handleUpdateToken} className="mt-4 bg-apple-red text-white py-3 px-8 rounded-full text-[10px] font-bold uppercase shadow-lg">Validate Token</button>
                            </div>
                        ) : !appleMusicAuthorized ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                                <AppleIcon className="w-12 h-12 text-apple-red mb-4 opacity-50" />
                                <p className="text-xs text-gray-500 max-w-xs mb-6">Connect your library to browse your playlists. Demo Mode is available if no production token is configured.</p>
                                <button onClick={authorizeAppleMusic} className="bg-apple-red text-white py-3 px-10 rounded-full text-[10px] font-bold uppercase shadow-xl">Connect Library</button>
                            </div>
                        ) : (
                            <div className="flex-1 flex overflow-hidden">
                                <aside className="w-1/3 border-r border-gray-800 p-4 space-y-2 overflow-y-auto custom-scrollbar">
                                    <h4 className="text-[8px] font-black text-gray-600 uppercase tracking-widest mb-4">Playlists</h4>
                                    {appleMusicPlaylists.map(playlist => (
                                        <button key={playlist.id} onClick={() => fetchAppleTracks(playlist.id)} className={`w-full text-left p-2 rounded-lg text-[9px] font-bold transition-all ${selectedApplePlaylist === playlist.id ? 'bg-apple-red/20 text-white' : 'hover:bg-gray-800'}`}>{playlist.attributes.name}</button>
                                    ))}
                                </aside>
                                <section className="flex-1 p-4 grid grid-cols-2 gap-3 overflow-y-auto custom-scrollbar">
                                    {appleMusicTracks.map(track => (
                                        <div key={track.id} className="bg-gray-950/50 p-3 rounded-xl border border-gray-800 flex justify-between items-center group">
                                            <div className="min-w-0">
                                                <p className="text-[9px] font-bold text-white truncate">{track.attributes.name}</p>
                                                <p className="text-[7px] text-gray-600 uppercase truncate">{track.attributes.artistName}</p>
                                            </div>
                                            <button onClick={() => { addAppleMusicTrack(track); setIsMusicBrowserOpen(false); }} className="bg-apple-red p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"><PlusIcon className="w-3 h-3 text-white"/></button>
                                        </div>
                                    ))}
                                </section>
                            </div>
                        )}
                        <footer className="p-3 bg-black/40 text-center border-t border-gray-800"><p className="text-[7px] text-gray-600 font-bold uppercase tracking-widest">{isDemoMode ? 'SIMULATED DEMO' : 'PRODUCTION SYNC ACTIVE'}</p></footer>
                    </div>
                </div>
            )}

            {/* TIMELINE EDITOR */}
            {isAdvancedEditorOpen && (
                <div className="fixed inset-0 bg-brand-dark z-[100] flex flex-col p-6 animate-fade-in overflow-hidden">
                    <header className="flex justify-between items-center mb-8 shrink-0"><div><h2 className="text-2xl font-black uppercase flex items-center gap-3">Studio Timeline</h2></div><button onClick={() => setIsAdvancedEditorOpen(false)} className="bg-gray-800 p-3 rounded-full"><XIcon className="w-6 h-6"/></button></header>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6">
                        <div className="bg-gray-950/50 rounded-2xl p-6 border border-gray-800">
                            <div className="space-y-4">
                                <div className="flex gap-4 items-center">
                                    <div className="w-24 text-[9px] font-black uppercase text-gray-600">Visuals</div>
                                    <div className="flex-1 h-12 bg-gray-900 rounded-lg relative overflow-x-auto">
                                        {mediaWithTimestamps.map((m, i) => <div key={m.id} className="h-full border-r border-gray-800 bg-brand-purple/10 flex items-center justify-center text-[8px] font-black" style={{ width: `${(m.timelineEnd - m.timelineStart) * 10}px`, minWidth: '30px' }}>{i+1}</div>)}
                                    </div>
                                </div>
                                <div className="flex gap-4 items-center">
                                    <div className="w-24 text-[9px] font-black uppercase text-gray-600">Audio</div>
                                    <div className="flex-1 min-h-[100px] bg-gray-900 rounded-lg p-2 space-y-2">
                                        {audioFiles.map((a, idx) => (
                                            <div key={a.id} className="h-8 border border-gray-700 rounded-md relative flex items-center px-2 bg-gray-950/50" style={{ marginLeft: `${a.startTime * 10}px`, width: `${a.duration * 10}px` }}>
                                                <span className="text-[7px] font-black truncate">{a.name}</span>
                                                <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))} className="absolute -top-1 -right-1 bg-red-500 rounded p-0.5"><XIcon className="w-2 h-2"/></button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <footer className="p-6 bg-gray-950/50 rounded-t-3xl mt-auto flex justify-between items-center"><div className="text-xl font-bold text-brand-purple">{formatDuration(totalSlideshowDuration)}</div><button onClick={() => { setIsAdvancedEditorOpen(false); setElapsedTime(0); setIsPlaying(true); }} className="bg-brand-purple text-white px-8 py-3 rounded-xl font-bold text-xs uppercase">Preview Studio</button></footer>
                </div>
            )}

            {/* THEATER MODE */}
            {isPlaying && (
                <div className="fixed inset-0 bg-black z-[100] flex flex-col items-center justify-center animate-fade-in">
                    <button onClick={() => setIsPlaying(false)} className="absolute top-8 right-8 text-white/50 hover:text-white p-2 z-[110]"><XIcon className="w-10 h-10"/></button>
                    <div className="w-full h-full relative flex items-center justify-center overflow-hidden">
                        {mediaWithTimestamps.map((media, index) => {
                            const isVisible = index === currentSlide;
                            const isPreloading = index === currentSlide + 1;
                            if (!isVisible && !isPreloading) return null;
                            return <TheaterMedia key={media.id} media={media as any} isVisible={isVisible} isPreloading={isPreloading} muteVideos={settings.muteVideos} elapsedTime={elapsedTime} slideStyle={settings.slideStyle} />;
                        })}
                    </div>
                    {audioFiles.map((a) => {
                        const isActive = elapsedTime >= a.startTime && elapsedTime < (a.startTime + a.duration);
                        const inTime = elapsedTime - a.startTime;
                        let vol = isActive ? (a.fadeIn > 0 && inTime < a.fadeIn ? inTime / a.fadeIn : (a.fadeOut > 0 && inTime > (a.duration - a.fadeOut) ? (a.duration - inTime) / a.fadeOut : 1.0)) * (settings.muteVideos ? 0.2 : 1.0) : 0;
                        if (a.source === 'apple-music') return <AppleMusicPlayer key={a.id} trackId={a.appleMusicTrackId!} active={isActive} volume={vol} startTimeInFile={inTime} isDemo={isDemoMode} demoAudioUrl={a.demoAudioUrl} />;
                        return <AudioPlayer key={a.id} src={a.previewUrl} active={isActive} volume={vol} startTimeInFile={inTime} />;
                    })}
                </div>
            )}
            
            <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #6d28d9; border-radius: 10px; }`}</style>
        </div>
    );
};

export default App;
