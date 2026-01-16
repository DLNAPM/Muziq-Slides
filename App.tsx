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
  appId: "1:577247718021:web:4ee585b9aad338501797ec",
  measurementId: "G-SKRCL4J4GD"
};

// --- FIREBASE INITIALIZATION ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// --- APPLE MUSIC CONFIGURATION ---
const APPLE_MUSIC_TOKEN = 'APPLE_MUSIC_DEVELOPER_TOKEN'; 

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
    autoFadeInterval: number; // 0, 3, or 5
    muteVideos: boolean;
}

interface SerializedMediaFile {
    id: string;
    type: 'image' | 'video';
    name: string;
    url: string; 
    storagePath: string;
    caption?: string;
    aiCaption?: string;
    rotation?: number;
    duration?: number;
    volume?: number;
    duckBGM?: boolean;
}

interface SerializedAudioFile {
    id: string;
    name: string;
    url: string;
    storagePath: string;
    duration?: number;
    startTime?: number;
    fadeIn?: number;
    fadeOut?: number;
    source: 'local' | 'apple-music';
    appleMusicTrackId?: string;
}

interface SavedSlideshow {
    id: string; 
    userId: string;
    userEmail?: string;
    name: string;
    media: SerializedMediaFile[];
    audio: SerializedAudioFile[];
    settings: SlideshowSettings;
    timestamp?: any; 
    createdAt?: any; 
    totalDuration?: number;
    collaborators?: Collaborator[];
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
    };
}

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

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

const urlToBase64 = async (url: string): Promise<string> => {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

const AppleMusicPlayer: React.FC<{
    trackId: string;
    active: boolean;
    volume: number;
    startTimeInFile: number;
    isDemo?: boolean;
}> = ({ trackId, active, volume, startTimeInFile, isDemo }) => {
    const lastVolumeRef = useRef(volume);

    useEffect(() => {
        if (isDemo) return;
        const music = (window as any).MusicKit?.getInstance();
        if (!music) return;

        const handlePlayback = async () => {
            if (active) {
                try {
                    if (music.nowPlayingItem?.id !== trackId) {
                        await music.setQueue({ song: trackId });
                    }
                    if (music.playbackState !== 2) { 
                        await music.play();
                    }
                    const diff = Math.abs(music.currentPlaybackTime - startTimeInFile);
                    if (diff > 1.0) {
                        await music.seekToTime(startTimeInFile);
                    }
                } catch (e) {
                    console.error("Apple Music Playback Error", e);
                }
            } else {
                if (music.nowPlayingItem?.id === trackId && music.playbackState === 2) {
                    music.pause();
                }
            }
        };
        handlePlayback();
    }, [active, trackId, startTimeInFile, isDemo]);

    useEffect(() => {
        if (isDemo) return;
        const music = (window as any).MusicKit?.getInstance();
        if (!music) return;
        if (Math.abs(lastVolumeRef.current - volume) > 0.05) {
            music.volume = Math.max(0, Math.min(1, volume));
            lastVolumeRef.current = volume;
        }
    }, [volume, isDemo]);

    return null; 
};

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
            } else if (offset >= (media as any).duration) {
                video.pause();
            }
        } else {
            video.pause();
            if (isPreloading) {
                video.currentTime = 0;
                video.load();
            }
        }
    }, [isVisible, isPreloading, muteVideos, (media as any).timelineStart, (media as any).duration]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !isVisible || media.type !== 'video') return;
        const interval = setInterval(() => {
            const offset = elapsedTime - (media as any).timelineStart;
            if (Math.abs(video.currentTime - offset) > 0.8) {
                video.currentTime = offset;
            }
        }, 2000);
        return () => clearInterval(interval);
    }, [isVisible, elapsedTime, (media as any).timelineStart]);

    return (
        <div className={`w-full h-full absolute inset-0 flex items-center justify-center transition-opacity duration-700 ${isVisible ? 'opacity-100 z-20' : 'opacity-0 z-10'}`}>
            <div className={`w-full h-full flex items-center justify-center animate-${isVisible ? slideStyle : 'none'}`}>
                {media.type === 'image' ? (
                    <img src={media.previewUrl} className="w-full h-full object-contain" alt="slide" />
                ) : (
                    <video 
                        ref={videoRef}
                        src={media.previewUrl} 
                        className="w-full h-full object-contain shadow-2xl" 
                        playsInline
                        preload="auto"
                        loop={false}
                    />
                )}
            </div>
        </div>
    );
};

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
            if (audio.paused) {
                audio.play().catch(() => {});
            }
            if (Math.abs(audio.currentTime - startTimeInFile) > 0.5) {
                audio.currentTime = startTimeInFile;
            }
        } else {
            if (!audio.paused) {
                audio.pause();
            }
        }
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

const UploadIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>;
const MusicIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-13c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>;
const AppleIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="currentColor" viewBox="0 0 384 512"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>;
const PlayIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const PauseIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const RewindIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.334 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" /></svg>;
const FastForwardIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6l-5.334-4A1 1 0 005 8v8a1 1 0 001.6.8l5.334-4zM19.933 12.8a1 1 0 000-1.6l-5.334-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.334-4z" /></svg>;
const XIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
const PlusIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>;
const TrashIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>;
const ShareIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>;
const DuplicateIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>;
const SparklesIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>;
const VolumeOffIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15L4 13.414V10.586L5.586 9M9 5L5 9H2V15H5L9 19V5ZM15.536 8.464l-4.243 4.243m0-4.243l4.243 4.243" /></svg>;
const SettingsIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
const ChevronLeftIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>;
const ChevronRightIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>;
const BeakerIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.673.337a4 4 0 01-2.506.326l-1.741-.348a2 2 0 11.774-3.925l1.74.348a6 6 0 003.759-.488l.673-.337a8 8 0 015.147-.689l2.387.477a4 4 0 012.988 4.766l-1.054 5.27a2 2 0 01-3.126 1.264l-2.383-1.588a4 4 0 00-4.431 0l-2.383 1.588a2 2 0 01-3.126-1.264l1.054-5.27a4 4 0 00-.747-3.411L3.834 11a2 2 0 011.264-3.126l5.27-1.054a4 4 0 003.411-.747l2.126-2.126a2 2 0 013.126 1.264l1.054 5.27a4 4 0 000.747 3.411l2.126 2.126a2 2 0 010.126 2.701z" /></svg>;
const UsersIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
const FilmIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" /></svg>;
const QuestionIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;

const App: React.FC = () => {
    const [user, setUser] = useState<User | null>(null);
    const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
    const [audioFiles, setAudioFiles] = useState<AppStateAudio[]>([]);
    const [settings, setSettings] = useState<SlideshowSettings>({
        interval: 5, 
        slideStyle: 'ken-burns', 
        showClock: true, 
        smartCaptionsEnabled: false, 
        repeatSlideshow: false, 
        showCaptions: true,
        autoFadeEnabled: false,
        autoFadeInterval: 3,
        muteVideos: false,
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
    const [isFetchingData, setIsFetchingData] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isAdvancedEditorOpen, setIsAdvancedEditorOpen] = useState(false);
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    
    const [isMusicBrowserOpen, setIsMusicBrowserOpen] = useState(false);
    const [appleMusicAuthorized, setAppleMusicAuthorized] = useState(false);
    const [isDemoMode, setIsDemoMode] = useState(false);
    const [appleMusicPlaylists, setAppleMusicPlaylists] = useState<AppleMusicPlaylist[]>([]);
    const [appleMusicTracks, setAppleMusicTracks] = useState<AppleMusicTrack[]>([]);
    const [selectedApplePlaylist, setSelectedApplePlaylist] = useState<string | null>(null);

    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [shareSlideshowTarget, setShareSlideshowTarget] = useState<SavedSlideshow | null>(null);
    const [shareEmail, setShareEmail] = useState('');
    const [shareRole, setShareRole] = useState<'viewer' | 'editor'>('viewer');

    const fileInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    
    const requestRef = useRef<number>(0);
    const startTimeRef = useRef<number>(0);
    const lastTickTimeRef = useRef<number>(0);

    useEffect(() => {
        const initMusicKit = async () => {
            if (!(window as any).MusicKit) return;
            try {
                const music = await (window as any).MusicKit.configure({
                    developerToken: APPLE_MUSIC_TOKEN,
                    app: {
                        name: 'Muziq Slides',
                        build: '1.0.0'
                    }
                });
                setAppleMusicAuthorized(music.isAuthorized);
            } catch (e) {
                console.warn("Apple MusicKit configuration failed.");
            }
        };
        initMusicKit();
    }, []);

    const authorizeAppleMusic = async () => {
        setError(null);
        if (APPLE_MUSIC_TOKEN === 'APPLE_MUSIC_DEVELOPER_TOKEN') {
            setIsProcessing(true);
            setTimeout(() => {
                setIsDemoMode(true);
                setAppleMusicAuthorized(true);
                setAppleMusicPlaylists([
                    { id: 'p1', attributes: { name: 'Summer Vibes 2024', artwork: { url: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=200&h=200&fit=crop' } } },
                    { id: 'p2', attributes: { name: 'Family Dinner Mix', artwork: { url: 'https://images.unsplash.com/photo-1493225255756-d9584f8606e9?w=200&h=200&fit=crop' } } },
                    { id: 'p3', attributes: { name: 'Focus Beats', artwork: { url: 'https://images.unsplash.com/photo-1459749411177-042180ce673c?w=200&h=200&fit=crop' } } },
                ]);
                setIsProcessing(false);
            }, 800);
            return;
        }
        const music = (window as any).MusicKit?.getInstance();
        if (!music) {
            setError("MusicKit engine failed to initialize.");
            return;
        }
        try {
            await music.authorize();
            setAppleMusicAuthorized(true);
            fetchApplePlaylists();
        } catch (e: any) {
            setError(`Apple Music connection failed: ${e.message || 'Authorization rejected'}`);
        }
    };

    const fetchApplePlaylists = async () => {
        if (isDemoMode) return;
        const music = (window as any).MusicKit?.getInstance();
        if (!music || !music.isAuthorized) return;
        try {
            const playlists = await music.api.library.playlists();
            setAppleMusicPlaylists(playlists || []);
        } catch (e) {
            setError("Could not retrieve library playlists.");
        }
    };

    const fetchAppleTracks = async (playlistId: string) => {
        setSelectedApplePlaylist(playlistId);
        if (isDemoMode) {
            setAppleMusicTracks([
                { id: 't1', attributes: { name: 'Starlight Serenade', artistName: 'Demo Artist 1', durationInMillis: 180000, artwork: { url: 'https://images.unsplash.com/photo-1514525253344-f2501065c711?w=100&h=100&fit=crop' } } },
                { id: 't2', attributes: { name: 'Neon Horizons', artistName: 'Demo Artist 2', durationInMillis: 215000, artwork: { url: 'https://images.unsplash.com/photo-1496293455970-f8581aae0e3c?w=100&h=100&fit=crop' } } },
                { id: 't3', attributes: { name: 'Echoes of Home', artistName: 'Demo Artist 3', durationInMillis: 192000, artwork: { url: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=100&h=100&fit=crop' } } },
            ]);
            return;
        }
        const music = (window as any).MusicKit?.getInstance();
        if (!music || !music.isAuthorized) return;
        try {
            const playlist = await music.api.library.playlist(playlistId);
            setAppleMusicTracks(playlist.relationships.tracks.data || []);
        } catch (e) {
            setError("Failed to fetch tracks.");
        }
    };

    const addAppleMusicTrack = (track: AppleMusicTrack) => {
        setAudioFiles(p => [...p, {
            id: `am-${track.id}-${Date.now()}`,
            name: track.attributes.name,
            duration: track.attributes.durationInMillis / 1000,
            startTime: 0,
            fadeIn: 1,
            fadeOut: 1,
            previewUrl: track.attributes.artwork?.url.replace('{w}', '100').replace('{h}', '100') || '',
            source: 'apple-music',
            appleMusicTrackId: track.id
        }]);
    };

    useEffect(() => {
        if (isHelpOpen || isPlaying || isMusicBrowserOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    }, [isHelpOpen, isPlaying, isMusicBrowserOpen]);

    useEffect(() => {
        return () => {
            mediaFiles.forEach(m => { if (m.previewUrl.startsWith('blob:')) URL.revokeObjectURL(m.previewUrl); });
            audioFiles.forEach(a => { if (a.previewUrl.startsWith('blob:')) URL.revokeObjectURL(a.previewUrl); });
        };
    }, [mediaFiles.length, audioFiles.length]);

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

    useEffect(() => {
        if (!settings.autoFadeEnabled || audioFiles.length === 0) return;
        let runningStart = 0;
        let changed = false;
        const recalculated = audioFiles.map((track, i) => {
            const interval = settings.autoFadeInterval;
            let targetStart = 0;
            let targetFadeIn = 0.5;
            let targetFadeOut = 0.5;
            if (i === 0) {
                targetStart = 0;
                targetFadeIn = 0.5;
                targetFadeOut = audioFiles.length > 1 ? (interval || 0.5) : 1;
                runningStart = track.duration;
            } else {
                targetStart = Math.max(0, runningStart - interval);
                targetFadeIn = interval || 0.5;
                targetFadeOut = (i === audioFiles.length - 1) ? 1 : (interval || 0.5);
                runningStart = targetStart + track.duration;
            }
            if (track.startTime !== targetStart || track.fadeIn !== targetFadeIn || track.fadeOut !== targetFadeOut) {
                changed = true;
                return { ...track, startTime: targetStart, fadeIn: targetFadeIn, fadeOut: targetFadeOut };
            }
            return track;
        });
        if (changed) setAudioFiles(recalculated);
    }, [settings.autoFadeEnabled, settings.autoFadeInterval, audioFiles.length]);

    const resetWorkspace = useCallback(() => {
        mediaFiles.forEach(m => { if (m.previewUrl.startsWith('blob:')) URL.revokeObjectURL(m.previewUrl); });
        audioFiles.forEach(a => { if (a.previewUrl.startsWith('blob:')) URL.revokeObjectURL(a.previewUrl); });
        setMediaFiles([]);
        setAudioFiles([]);
        setSlideshowName('');
        setCurrentSlideshowId(null);
        setError(null);
        setCurrentSlide(0);
        setIsPlaying(false);
        setElapsedTime(0);
    }, [mediaFiles, audioFiles]);

    const userPermission = useMemo(() => {
        if (!user || !currentSlideshowId) return 'owner';
        const found = ownedSlideshows.find(s => s.id === currentSlideshowId);
        if (found) return 'owner';
        const shared = sharedWithMeSlideshows.find(s => s.id === currentSlideshowId);
        if (shared) return shared.collaborators?.find(c => c.email.toLowerCase() === user.email?.toLowerCase())?.role || 'viewer';
        return 'owner';
    }, [user, currentSlideshowId, ownedSlideshows, sharedWithMeSlideshows]);

    const canEdit = userPermission === 'owner' || userPermission === 'editor';

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => { 
            setUser(u); 
            if (!u) resetWorkspace();
            setIsLoading(false); 
        });
        return unsubscribe;
    }, [resetWorkspace]);

    useEffect(() => {
        const stableUserUid = user?.uid;
        const stableUserEmail = user?.email?.toLowerCase();
        if (!stableUserUid || !stableUserEmail) {
            setOwnedSlideshows([]);
            setSharedWithMeSlideshows([]);
            setIsFetchingData(false);
            return;
        }
        setIsFetchingData(true);
        const slideshowsRef = collection(db, "slideshows");
        const qOwned = query(slideshowsRef, where("userId", "==", stableUserUid));
        const unsubOwned = onSnapshot(qOwned, (snap) => {
            setOwnedSlideshows(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow)));
            setIsFetchingData(false);
        }, () => setIsFetchingData(false));
        const qShared = query(slideshowsRef, where("collaboratorEmails", "array-contains", stableUserEmail));
        const unsubShared = onSnapshot(qShared, (snap) => {
            setSharedWithMeSlideshows(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow)));
        });
        return () => { unsubOwned(); unsubShared(); };
    }, [user?.uid, user?.email]); 

    const allSlideshows = useMemo(() => {
        const combined = [...ownedSlideshows, ...sharedWithMeSlideshows];
        const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
        return unique.sort((a, b) => (getMillis(b.timestamp) || getMillis(b.createdAt) || 0) - (getMillis(a.timestamp) || getMillis(a.createdAt) || 0));
    }, [ownedSlideshows, sharedWithMeSlideshows]);

    const animate = useCallback((time: number) => {
        if (!startTimeRef.current) {
            startTimeRef.current = time;
            lastTickTimeRef.current = time;
        }
        const delta = (time - lastTickTimeRef.current) / 1000;
        lastTickTimeRef.current = time;
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
            lastTickTimeRef.current = performance.now();
            requestRef.current = requestAnimationFrame(animate);
        } else {
            cancelAnimationFrame(requestRef.current);
        }
        return () => cancelAnimationFrame(requestRef.current);
    }, [isPlaying, animate]);

    useEffect(() => {
        const activeIdx = mediaWithTimestamps.findIndex(m => elapsedTime >= m.timelineStart && elapsedTime < m.timelineEnd);
        if (activeIdx !== -1 && activeIdx !== currentSlide) setCurrentSlide(activeIdx);
    }, [elapsedTime, mediaWithTimestamps, currentSlide]);

    const generateSmartCaptions = async () => {
        if (!settings.smartCaptionsEnabled) return;
        setIsProcessing(true);
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        try {
            const updatedMedia = await Promise.all(mediaFiles.map(async (m) => {
                if (m.type === 'image' && !m.caption && !m.aiCaption) {
                    let base64Data = m.file ? await fileToBase64(m.file) : (m.serverData ? await urlToBase64(m.serverData.url) : '');
                    if (base64Data) {
                        const response = await ai.models.generateContent({
                            model: 'gemini-3-flash-preview',
                            contents: {
                                parts: [
                                    { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
                                    { text: "Describe this image in a short, poetic caption for a family slideshow. Max 10 words. Don't use quotes." }
                                ]
                            }
                        });
                        return { ...m, aiCaption: response.text?.trim() };
                    }
                }
                return m;
            }));
            setMediaFiles(updatedMedia as MediaFile[]);
        } catch (e) { console.error(e); } finally { setIsProcessing(false); }
    };

    const handleLogin = async () => {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        try { await signInWithPopup(auth, provider); resetWorkspace(); } catch (e: any) { setError("Sign in failed: " + e.message); }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const files = (Array.from(e.target.files) as File[]).slice(0, 20 - mediaFiles.length);
        const resolved: MediaFile[] = [];
        for (const f of files) {
            const isImg = f.type.startsWith('image/');
            const dur = isImg ? 0 : await getMediaDuration(f);
            if (!isImg && dur > 60) { setError(`Video "${f.name}" is too long.`); continue; }
            resolved.push({
                id: `m-${Math.random().toString(36).substr(2, 9)}`,
                file: f, previewUrl: URL.createObjectURL(f), type: isImg ? 'image' : 'video',
                rotation: 0, caption: '', duration: dur, volume: 1.0, duckBGM: true
            } as MediaFile);
        }
        setMediaFiles(p => [...p, ...resolved]);
    };

    const handleAudioChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0]) return;
        const file = e.target.files[0];
        const duration = await getMediaDuration(file);
        setAudioFiles(p => [...p, { id: `a-${Date.now()}`, file, name: file.name, duration, startTime: 0, fadeIn: 1, fadeOut: 1, source: 'local', previewUrl: URL.createObjectURL(file) }]);
    };

    const moveMedia = (index: number, direction: 'left' | 'right') => {
        const newMedia = [...mediaFiles];
        const targetIndex = direction === 'left' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= newMedia.length) return;
        [newMedia[index], newMedia[targetIndex]] = [newMedia[targetIndex], newMedia[index]];
        setMediaFiles(newMedia);
    };

    const handleSave = async () => {
        if (!user || !mediaFiles.length || !canEdit || !user.email) return;
        setIsSaving(true); setError(null);
        try {
            const id = currentSlideshowId || doc(collection(db, 'slideshows')).id;
            const serMedia = await Promise.all(mediaFiles.map(async m => {
                const b: any = { id: m.id, type: m.type, name: m.id, rotation: m.rotation, caption: (m as any).caption, aiCaption: (m as any).aiCaption, duration: (m as any).duration, volume: (m as any).volume, duckBGM: (m as any).duckBGM };
                if (!m.serverData && m.file) {
                    const path = `users/${user.uid}/${id}/${m.id}`;
                    await uploadBytes(ref(storage, path), m.file);
                    b.url = await getDownloadURL(ref(storage, path)); b.storagePath = path;
                } else { b.url = m.serverData?.url; b.storagePath = m.serverData?.storagePath; }
                return b;
            }));
            const serAudio = await Promise.all(audioFiles.map(async a => {
                const b: any = { id: a.id, name: a.name, duration: a.duration, startTime: a.startTime, fadeIn: a.fadeIn, fadeOut: a.fadeOut, source: a.source, appleMusicTrackId: a.appleMusicTrackId };
                if (a.source === 'local') {
                    if (!a.serverData && a.file) {
                        const path = `users/${user.uid}/${id}/a-${a.id}`;
                        await uploadBytes(ref(storage, path), a.file);
                        b.url = await getDownloadURL(ref(storage, path)); b.storagePath = path;
                    } else { b.url = a.serverData?.url; b.storagePath = a.serverData?.storagePath; }
                } else { b.url = a.previewUrl; b.storagePath = ""; }
                return b;
            }));
            const existing = allSlideshows.find(s => s.id === id);
            const collabEmails = Array.from(new Set([user.email.toLowerCase(), ...(existing?.collaboratorEmails || [])]));
            await setDoc(doc(db, 'slideshows', id), { userId: existing?.userId || user.uid, userEmail: existing?.userEmail || user.email, name: slideshowName || 'My Slideshow', media: serMedia, audio: serAudio, settings, totalDuration: totalSlideshowDuration, timestamp: serverTimestamp(), createdAt: existing?.createdAt || serverTimestamp(), collaborators: existing?.collaborators || [], collaboratorEmails: collabEmails }, { merge: true });
            setCurrentSlideshowId(id);
        } catch (e: any) { setError("Cloud save failed: " + e.message); } finally { setIsSaving(false); }
    };

    const handleLoad = (s: SavedSlideshow) => {
        setIsPlaying(false); setCurrentSlide(0); setElapsedTime(0);
        setMediaFiles((s.media || []).map(m => ({ id: m.id, type: m.type as any, previewUrl: m.url, rotation: m.rotation || 0, caption: m.caption || '', aiCaption: m.aiCaption || '', duration: m.duration || 0, volume: m.volume ?? 1.0, duckBGM: m.duckBGM ?? true, serverData: { url: m.url, storagePath: m.storagePath } })));
        setAudioFiles((s.audio || []).map(a => ({ id: a.id, name: a.name, duration: a.duration || 0, startTime: a.startTime || 0, fadeIn: a.fadeIn || 1, fadeOut: a.fadeOut || 1, previewUrl: a.url, source: a.source || 'local', appleMusicTrackId: a.appleMusicTrackId, serverData: a.storagePath ? { url: a.url, storagePath: a.storagePath } : undefined })));
        if (s.settings) setSettings(s.settings); 
        if (s.name) setSlideshowName(s.name); 
        setCurrentSlideshowId(s.id); setError(null);
    };

    const handleClone = async (s: SavedSlideshow) => {
        if (!user?.email) return;
        setIsProcessing(true);
        try {
            await addDoc(collection(db, 'slideshows'), { userId: user.uid, userEmail: user.email, name: `Copy of ${s.name}`, media: s.media, audio: s.audio, settings: s.settings, totalDuration: s.totalDuration, timestamp: serverTimestamp(), createdAt: serverTimestamp(), collaborators: [], collaboratorEmails: [user.email.toLowerCase()] });
            setError(`Cloned as "Copy of ${s.name}"!`);
        } catch (e: any) { setError("Cloning failed: " + e.message); } finally { setIsProcessing(false); }
    };

    const handleDelete = async (s: SavedSlideshow) => {
        if (s.userId !== user?.uid) return;
        if (!window.confirm(`Delete "${s.name}"?`)) return;
        setIsProcessing(true);
        try { await deleteDoc(doc(db, 'slideshows', s.id)); if (currentSlideshowId === s.id) resetWorkspace(); } catch (e: any) { setError("Deletion error: " + e.message); } finally { setIsProcessing(false); }
    };

    const startPlayback = async () => {
        if (mediaFiles.length === 0) return;
        if (settings.smartCaptionsEnabled) await generateSmartCaptions();
        setElapsedTime(0); setCurrentSlide(0); setIsPlaying(true);
    };

    const skipForward = () => setElapsedTime(prev => Math.min(prev + 5, totalSlideshowDuration));
    const skipBackward = () => setElapsedTime(prev => Math.max(prev - 5, 0));

    const handleShareSlideshow = async () => {
        if (!shareSlideshowTarget || !shareEmail) return;
        setIsProcessing(true);
        try {
            const updatedCollabs = [...(shareSlideshowTarget.collaborators || []), { email: shareEmail.trim().toLowerCase(), role: shareRole }];
            const updatedEmails = Array.from(new Set([...(shareSlideshowTarget.collaboratorEmails || []), shareEmail.trim().toLowerCase()]));
            await setDoc(doc(db, 'slideshows', shareSlideshowTarget.id), { collaborators: updatedCollabs, collaboratorEmails: updatedEmails }, { merge: true });
            setShareSlideshowTarget({ ...shareSlideshowTarget, collaborators: updatedCollabs, collaboratorEmails: updatedEmails }); setShareEmail(''); setError(`Shared with ${shareEmail}!`);
        } catch (e: any) { setError("Sharing failed: " + e.message); } finally { setIsProcessing(false); }
    };

    const removeCollaborator = async (email: string) => {
        if (!shareSlideshowTarget) return;
        setIsProcessing(true);
        try {
            const updatedCollabs = (shareSlideshowTarget.collaborators || []).filter(c => c.email !== email);
            const updatedEmails = Array.from(new Set([shareSlideshowTarget.userEmail?.toLowerCase() || "", ...updatedCollabs.map(c => c.email.toLowerCase())])).filter(Boolean);
            await setDoc(doc(db, 'slideshows', shareSlideshowTarget.id), { collaborators: updatedCollabs, collaboratorEmails: updatedEmails }, { merge: true });
            setShareSlideshowTarget({ ...shareSlideshowTarget, collaborators: updatedCollabs, collaboratorEmails: updatedEmails });
        } catch (e: any) { setError("Removal failed: " + e.message); } finally { setIsProcessing(false); }
    };

    const getDuckingFactor = useCallback((time: number) => {
        if (settings.muteVideos) return 1.0;
        const segment = mediaWithTimestamps.find(m => m.type === 'video' && (m as VideoFile).duckBGM && time >= m.timelineStart && time < m.timelineEnd);
        if (!segment) return 1.0;
        const timeIn = time - segment.timelineStart, timeOut = segment.timelineEnd - time, FADE = 0.8, LEVEL = 0.15, segIdx = mediaWithTimestamps.indexOf(segment);
        const prevDuck = segIdx > 0 && mediaWithTimestamps[segIdx - 1].type === 'video' && (mediaWithTimestamps[segIdx - 1] as VideoFile).duckBGM;
        const nextDuck = segIdx < mediaWithTimestamps.length - 1 && mediaWithTimestamps[segIdx + 1].type === 'video' && (mediaWithTimestamps[segIdx + 1] as VideoFile).duckBGM;
        let duckFactor = LEVEL;
        if (!prevDuck && timeIn < FADE) duckFactor = 1.0 - (timeIn / FADE * (1.0 - LEVEL));
        if (!nextDuck && timeOut < FADE) { const endRamp = 1.0 - (timeOut / FADE * (1.0 - LEVEL)); duckFactor = Math.max(duckFactor, endRamp); }
        return duckFactor;
    }, [mediaWithTimestamps, settings.muteVideos]);

    if (isLoading) return <div className="min-h-screen bg-brand-dark flex items-center justify-center"><div className="w-12 h-12 border-4 border-brand-purple border-t-transparent rounded-full animate-spin"></div></div>;

    return (
        <div className={`min-h-screen font-sans ${user ? 'bg-brand-dark text-gray-200' : 'bg-white text-gray-900'}`}>
            {(isSaving || isProcessing) && <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center backdrop-blur-sm"><div className="text-center p-8 bg-gray-900/80 rounded-[2rem] border border-gray-800 shadow-2xl"><div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-brand-purple mx-auto"></div><p className="text-white text-xl mt-6 font-black tracking-tight uppercase">Processing...</p></div></div>}

            <header className={`p-4 flex justify-between items-center border-b sticky top-0 z-40 backdrop-blur-md ${user ? 'bg-gray-900/50 border-gray-800' : 'bg-white/90 border-gray-100'}`}>
                <h1 className="text-2xl font-bold tracking-tight"><span className="text-brand-purple">Muziq</span> Slides</h1>
                <div className="flex gap-4 items-center">
                    {user && <div className="hidden sm:flex flex-col items-end"><span className="text-xs text-white font-medium">{user.displayName || user.email}</span></div>}
                    {user ? <div className="flex gap-2"><button onClick={handleLogin} className="bg-gray-800 text-white py-2 px-4 rounded-lg text-sm font-bold transition-all hover:bg-gray-700 border border-gray-700">Switch</button><button onClick={() => signOut(auth)} className="bg-brand-purple text-white py-2 px-6 rounded-lg text-sm font-bold shadow-md transition-all hover:bg-purple-700">Logout</button></div> : <button onClick={handleLogin} className="bg-brand-purple text-white py-2 px-6 rounded-lg text-sm font-bold shadow-md transition-all hover:bg-purple-700">Sign In</button>}
                </div>
            </header>

            {!user ? (
                <main className="animate-fade-in text-center pt-20 pb-32 px-4">
                    <div className="max-w-4xl mx-auto mb-20">
                        <h2 className="text-6xl font-extrabold mb-6 leading-tight tracking-tighter">Turn Memories into <br/><span className="text-brand-purple">Masterpieces</span></h2>
                        <p className="text-xl text-gray-600 mb-10 font-medium">Create beautiful photo slideshows with your favorite music. Perfect for Roku or Amazon Fire TV screensavers.</p>
                        <button onClick={handleLogin} className="bg-brand-purple text-white py-4 px-12 rounded-full text-lg font-bold shadow-2xl hover:scale-105 transition-transform active:scale-95">Get Started for Free</button>
                    </div>
                </main>
            ) : (
                <main className="p-4 sm:p-8 grid lg:grid-cols-2 gap-8 max-w-7xl mx-auto">
                    <div className="space-y-6">
                        {error && <div className="bg-red-500/20 border border-red-500/40 text-red-200 px-4 py-4 rounded-2xl text-sm flex justify-between items-center animate-fade-in"><span className="font-medium">{error}</span><button onClick={() => setError(null)} className="p-1"><XIcon className="w-5 h-5"/></button></div>}

                        <section className="bg-gray-800/40 p-6 rounded-[2.5rem] border border-gray-700/50 shadow-2xl">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-white uppercase tracking-tighter"><UploadIcon className="w-5 h-5 text-brand-purple"/> 1. Upload & Organize</h3>
                            <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-gray-700 rounded-[1.5rem] p-8 text-center cursor-pointer hover:border-brand-purple hover:bg-brand-purple/5 transition-all group"><UploadIcon className="w-12 h-12 mx-auto text-gray-500 mb-2 group-hover:scale-110 transition-transform group-hover:text-brand-purple"/><p className="text-sm text-gray-400 font-bold">Upload Photos or Videos (Max 20)</p></div>
                            <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept="image/*,video/*" className="hidden" />
                            <div className="mt-4 grid grid-cols-4 gap-3">
                                {mediaFiles.map((m, idx) => (
                                    <div key={m.id} className="aspect-square bg-black rounded-2xl overflow-hidden relative group border border-gray-700 shadow-lg">
                                        {m.type === 'image' ? <img src={m.previewUrl} className="w-full h-full object-cover transition-transform group-hover:scale-110" alt="preview" /> : <div className="w-full h-full relative"><video src={m.previewUrl} className="w-full h-full object-cover opacity-60" muted /><div className="absolute inset-0 flex items-center justify-center"><PlayIcon className="w-8 h-8 text-white opacity-80" /></div></div>}
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2"><div className="flex justify-end"><button onClick={() => setMediaFiles(p => p.filter(x => x.id !== m.id))} className="bg-red-600/90 p-1 rounded-lg hover:bg-red-500 transition-colors"><XIcon className="w-4 h-4 text-white"/></button></div><div className="flex justify-between items-center gap-1"><button onClick={() => moveMedia(idx, 'left')} disabled={idx === 0} className="bg-white/20 p-1.5 rounded-lg backdrop-blur-md hover:bg-white/40 disabled:opacity-20"><ChevronLeftIcon className="w-4 h-4 text-white"/></button><span className="text-[10px] font-black text-white bg-brand-purple/60 px-2 py-0.5 rounded-full">{idx + 1}</span><button onClick={() => moveMedia(idx, 'right')} disabled={idx === mediaFiles.length - 1} className="bg-white/20 p-1.5 rounded-lg backdrop-blur-md hover:bg-white/40 disabled:opacity-20"><ChevronRightIcon className="w-4 h-4 text-white"/></button></div></div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="bg-gray-800/40 p-6 rounded-[2.5rem] border border-gray-700/50 shadow-2xl">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-white uppercase tracking-tighter"><MusicIcon className="w-5 h-5 text-brand-purple"/> 2. Add Music</h3>
                            <div className="grid grid-cols-2 gap-3">
                                <button onClick={() => audioInputRef.current?.click()} className="bg-gray-700/30 hover:bg-gray-700/50 py-4 rounded-2xl font-black text-[10px] flex flex-col items-center justify-center gap-2 border border-gray-600/50 transition-all uppercase tracking-widest group"><PlusIcon className="w-6 h-6 text-gray-500 group-hover:text-white transition-colors"/><span>Local Audio</span></button>
                                <button onClick={() => { setIsMusicBrowserOpen(true); if (!appleMusicAuthorized) authorizeAppleMusic(); else fetchApplePlaylists(); }} className="bg-apple-red/10 hover:bg-apple-red/20 py-4 rounded-2xl font-black text-[10px] flex flex-col items-center justify-center gap-2 border border-apple-red/30 transition-all uppercase tracking-widest group"><AppleIcon className="w-6 h-6 text-apple-red"/><span>Apple Music</span></button>
                            </div>
                            <input type="file" ref={audioInputRef} onChange={handleAudioChange} accept="audio/*" className="hidden" />
                            <div className="mt-4 space-y-2">
                                {audioFiles.map(a => (
                                    <div key={a.id} className="bg-gray-900/40 p-5 rounded-2xl flex justify-between items-center text-sm font-medium border border-gray-700/50 group"><div className="flex items-center gap-3">{a.source === 'apple-music' ? <div className="relative"><img src={a.previewUrl} className="w-8 h-8 rounded-lg shadow-md" alt="art"/><AppleIcon className="w-2.5 h-2.5 text-apple-red absolute -bottom-1 -right-1" /></div> : <MusicIcon className="w-4 h-4 text-gray-500"/>}<div className="flex flex-col"><span className="text-xs font-bold truncate max-w-[150px]">{a.name}</span><span className="text-[10px] text-gray-500 font-bold">{formatDuration(a.duration)}</span></div></div><button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))}><TrashIcon className="w-5 h-5 text-red-400 opacity-0 group-hover:opacity-100 transition-all"/></button></div>
                                ))}
                            </div>
                        </section>

                        <section className="bg-gray-800/40 p-6 rounded-[2.5rem] border border-gray-700/50 shadow-2xl">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-white uppercase tracking-tighter"><SettingsIcon className="w-5 h-5 text-brand-purple"/> 3. Settings</h3>
                            <div className="space-y-6">
                                <div className="space-y-3"><div className="flex justify-between items-center"><label className="text-xs text-gray-500 font-black uppercase tracking-widest">Slide Duration</label><span className="text-brand-purple font-black text-sm">{settings.interval}s</span></div><input type="range" min="1" max="60" value={settings.interval} onChange={e => setSettings(s => ({...s, interval: +e.target.value}))} className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-purple" /></div>
                                <div className="space-y-3"><label className="text-xs text-gray-500 font-black uppercase tracking-widest block">Style</label><select value={settings.slideStyle} onChange={e => setSettings(s => ({...s, slideStyle: e.target.value}))} className="w-full bg-gray-900/50 border border-gray-700/50 rounded-2xl px-5 py-3 text-sm text-white font-bold outline-none appearance-none cursor-pointer"><option value="ken-burns">Ken Burns</option><option value="fade-in">Classic Fade</option><option value="zoom-in">Focus Zoom</option></select></div>
                            </div>
                        </section>
                    </div>

                    <div className="space-y-6">
                        <section className="bg-gray-800/40 p-6 rounded-[2.5rem] border border-gray-700/50 shadow-2xl">
                            <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-bold flex items-center gap-2 text-white uppercase tracking-tighter"><PlayIcon className="w-5 h-5 text-brand-purple"/> 4. Theater</h3><button onClick={() => setIsAdvancedEditorOpen(true)} className="text-[10px] bg-brand-purple/20 hover:bg-brand-purple/40 text-brand-purple px-4 py-2 rounded-xl font-black uppercase tracking-widest border border-brand-purple/30 flex items-center gap-2"><BeakerIcon className="w-4 h-4"/> Studio</button></div>
                            <div className="aspect-video bg-black rounded-[2rem] relative flex items-center justify-center overflow-hidden border border-gray-700/50 shadow-2xl group">{mediaFiles.length > 0 ? <><div className="absolute inset-0 flex items-center justify-center bg-gray-900">{mediaFiles[0].type === 'image' ? <img src={mediaFiles[0].previewUrl} className="w-full h-full object-cover blur-2xl opacity-20" alt="bg" /> : <video src={mediaFiles[0].previewUrl} className="w-full h-full object-cover blur-2xl opacity-20" muted />}</div><button onClick={startPlayback} className="relative z-10 flex items-center justify-center bg-brand-purple p-8 rounded-full shadow-2xl hover:scale-110 active:scale-95 transition-all"><PlayIcon className="w-16 h-16 text-white"/></button></> : <p className="text-gray-600 font-black uppercase tracking-[0.2em] italic">No Media</p>}</div>
                        </section>

                        <section className="bg-gray-800/40 p-6 rounded-[2.5rem] border border-gray-700/50 shadow-2xl">
                            <h3 className="text-lg font-bold mb-4 text-white uppercase tracking-tighter">5. Project Archive</h3>
                            <div className="flex gap-2 mb-6">
                                <input value={slideshowName} onChange={e => setSlideshowName(e.target.value)} placeholder="Name your project..." className="flex-1 bg-gray-900/40 rounded-2xl px-5 py-4 border border-gray-700/50 outline-none focus:ring-2 focus:ring-brand-purple font-bold text-white shadow-inner" /><button onClick={handleSave} disabled={isSaving || !canEdit} className={`px-8 rounded-2xl font-black text-sm uppercase tracking-widest transition-all ${canEdit ? 'bg-brand-purple hover:bg-purple-700 shadow-brand-purple/20' : 'bg-gray-700 opacity-50'}`}>{isSaving ? '...' : 'Save'}</button>
                            </div>
                            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                                {allSlideshows.map(s => (
                                    <div key={s.id} className={`bg-gray-900/30 p-5 rounded-[1.5rem] flex justify-between items-center group border transition-all ${currentSlideshowId === s.id ? 'border-brand-purple bg-brand-purple/10' : 'border-gray-800/50 hover:border-gray-600'}`}><div className="flex-1 min-w-0"><h4 className="font-black text-sm text-white truncate uppercase tracking-tight">{s.name}</h4><p className="text-[9px] text-gray-500 font-bold uppercase">{formatDuration(s.totalDuration || 0)} • {s.media?.length || 0} Media</p></div><button onClick={() => handleLoad(s)} className="text-[9px] bg-white text-black py-2 px-5 rounded-xl font-black uppercase tracking-widest hover:scale-105 active:scale-95 shadow-xl">Load</button></div>
                                ))}
                            </div>
                        </section>
                    </div>
                </main>
            )}

            {isMusicBrowserOpen && (
                <div className="fixed inset-0 bg-black/95 z-[200] flex items-center justify-center p-4 sm:p-8 animate-fade-in backdrop-blur-xl">
                    <div className="bg-gray-900 w-full max-w-4xl max-h-[90vh] rounded-[3rem] border border-apple-red/20 shadow-2xl flex flex-col relative overflow-hidden">
                        <header className="p-8 border-b border-white/5 flex justify-between items-center bg-apple-red/5">
                            <div className="flex items-center gap-4"><AppleIcon className="w-8 h-8 text-apple-red"/><div><h2 className="text-2xl font-black uppercase tracking-tighter">Apple Music Library</h2><p className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em]">{isDemoMode ? 'SIMULATED DEMO MODE' : 'Created Playlists'}</p></div></div>
                            <button onClick={() => setIsMusicBrowserOpen(false)} className="text-gray-500 hover:text-white transition-colors p-2"><XIcon className="w-10 h-10"/></button>
                        </header>

                        {!appleMusicAuthorized ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-6">
                                <div className="w-24 h-24 bg-apple-red/10 rounded-full flex items-center justify-center border border-apple-red/20"><AppleIcon className="w-12 h-12 text-apple-red" /></div>
                                <div><h3 className="text-xl font-black uppercase mb-2">Connect your Library</h3><p className="text-sm text-gray-400 max-w-sm">Connect to browse your created playlists and tracks.</p></div>
                                <button onClick={authorizeAppleMusic} className="bg-apple-red text-white py-4 px-12 rounded-full font-black text-sm uppercase tracking-widest shadow-2xl hover:scale-105 active:scale-95 transition-all">Authorize Now</button>
                            </div>
                        ) : (
                            <div className="flex-1 overflow-hidden flex flex-col sm:flex-row">
                                <aside className="w-full sm:w-72 border-r border-white/5 overflow-y-auto custom-scrollbar bg-gray-950/20 p-6 space-y-6">
                                    <h3 className="text-[10px] text-gray-500 font-black uppercase tracking-widest border-b border-white/10 pb-2">Playlists</h3>
                                    <div className="grid grid-cols-1 gap-2">
                                        {appleMusicPlaylists.map(playlist => (
                                            <button key={playlist.id} onClick={() => fetchAppleTracks(playlist.id)} className={`p-3 rounded-2xl flex items-center gap-3 transition-all border text-left ${selectedApplePlaylist === playlist.id ? 'bg-apple-red/20 border-apple-red shadow-lg' : 'bg-gray-900/40 border-gray-800 hover:border-apple-red/50'}`}>{playlist.attributes.artwork ? <img src={playlist.attributes.artwork.url.replace('{w}', '80').replace('{h}', '80')} className="w-12 h-12 rounded-xl shadow-lg" alt="art"/> : <div className="w-12 h-12 bg-gray-800 rounded-xl flex items-center justify-center"><MusicIcon className="w-6 h-6 text-gray-600"/></div>}<div className="min-w-0"><p className="text-[10px] font-black text-white truncate">{playlist.attributes.name}</p></div></button>
                                        ))}
                                    </div>
                                </aside>
                                <section className="flex-1 overflow-y-auto custom-scrollbar p-8">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {appleMusicTracks.map(track => (
                                            <div key={track.id} className="bg-gray-950/40 p-4 rounded-3xl border border-gray-800 flex justify-between items-center group hover:border-apple-red/30 transition-all">
                                                <div className="flex items-center gap-4 min-w-0">
                                                    {track.attributes.artwork && (
                                                        <img 
                                                            src={track.attributes.artwork.url.replace('{w}', '60').replace('{h}', '60')} 
                                                            className="w-12 h-12 rounded-2xl shadow-xl" 
                                                            alt="art"
                                                        />
                                                    )}
                                                    <div className="min-w-0">
                                                        <p className="text-[11px] font-black text-white leading-tight truncate">{track.attributes.name}</p>
                                                        <p className="text-[9px] text-gray-500 font-bold uppercase mt-1 truncate">{track.attributes.artistName}</p>
                                                    </div>
                                                </div>
                                                <button 
                                                    onClick={() => { addAppleMusicTrack(track); setIsMusicBrowserOpen(false); }} 
                                                    className="bg-apple-red text-white p-3 rounded-2xl hover:scale-110 active:scale-90 transition-all shadow-xl opacity-0 group-hover:opacity-100"
                                                >
                                                    <PlusIcon className="w-5 h-5"/>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            </div>
                        )}
                        <footer className="p-4 bg-black/40 border-t border-white/5 text-center"><p className="text-[8px] text-gray-600 font-black uppercase tracking-[0.3em]">{isDemoMode ? 'DEMO MODE' : 'Active Subscription Required'}</p></footer>
                    </div>
                </div>
            )}

            {isAdvancedEditorOpen && (
                <div className="fixed inset-0 bg-brand-dark z-[100] flex flex-col p-6 animate-fade-in overflow-hidden">
                    <header className="flex justify-between items-center mb-8 shrink-0"><div><h2 className="text-3xl font-black uppercase tracking-tighter flex items-center gap-4"><BeakerIcon className="w-8 h-8 text-brand-purple"/> Studio</h2></div><button onClick={() => setIsAdvancedEditorOpen(false)} className="bg-gray-800 hover:bg-gray-700 p-4 rounded-full transition-all border border-gray-700 shadow-xl"><XIcon className="w-6 h-6"/></button></header>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-8 pr-2 pb-20">
                        <div className="bg-gray-950/50 rounded-3xl p-6 border border-gray-800/50 shadow-2xl relative">
                            <div className="space-y-6 mt-4">
                                <div className="flex gap-4 group">
                                    <div className="w-40 shrink-0 bg-gray-900 p-4 rounded-2xl border border-gray-800 flex flex-col justify-center">Visuals</div>
                                    <div className="flex-1 h-20 bg-gray-950/40 rounded-2xl border border-gray-800/50 flex relative overflow-x-auto custom-scrollbar">{mediaWithTimestamps.map((m, idx) => <div key={m.id} className="h-full border-r border-gray-800 relative transition-all bg-brand-purple/10" style={{ width: `${(m.timelineEnd - m.timelineStart) * 20}px`, minWidth: '40px' }}><div className="absolute inset-0 flex flex-col items-center justify-center p-1"><span className="text-[8px] font-black text-white/40">{idx+1}</span></div></div>)}</div>
                                </div>
                                <div className="flex gap-4">
                                    <div className="w-40 shrink-0 bg-gray-900 p-4 rounded-2xl border border-gray-800 flex flex-col justify-center">Audio</div>
                                    <div className="flex-1 min-h-[160px] bg-gray-950/40 rounded-2xl border border-gray-800/50 p-4 space-y-3 relative overflow-x-auto custom-scrollbar">
                                        {audioFiles.map((a, idx) => (
                                            <div key={a.id} className="relative group/audio">
                                                <div className={`h-12 border rounded-xl relative overflow-hidden flex items-center px-4 ${a.source === 'apple-music' ? 'bg-apple-red/20 border-apple-red/30' : 'bg-blue-500/20 border-blue-500/30'}`} style={{ marginLeft: `${a.startTime * 20}px`, width: `${a.duration * 20}px` }}>{a.source === 'apple-music' ? <AppleIcon className="w-4 h-4 text-apple-red mr-3 shrink-0"/> : <MusicIcon className="w-4 h-4 text-blue-400 mr-3 shrink-0"/>}<span className="text-[10px] font-black text-white truncate shrink-0 max-w-[150px]">{a.name}</span></div>
                                                <div className="flex gap-4 mt-2 bg-gray-900/40 p-3 rounded-xl"><input type="range" min="0" max={Math.max(totalSlideshowDuration, a.startTime + a.duration)} step="1" value={a.startTime} onChange={e => { const updated = [...audioFiles]; updated[idx].startTime = parseInt(e.target.value); setAudioFiles(updated); }} className={`flex-1 ${a.source === 'apple-music' ? 'accent-apple-red' : 'accent-blue-500'}`} /><button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))}><TrashIcon className="w-4 h-4 text-red-500"/></button></div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <footer className="shrink-0 bg-gray-950 p-6 rounded-t-[2.5rem] border-t border-gray-800 flex justify-between items-center shadow-inner mt-auto"><div className="text-2xl font-black text-brand-purple">{formatDuration(totalSlideshowDuration)}</div><div className="flex gap-4"><button onClick={startPlayback} className="bg-brand-purple text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-purple-700 shadow-xl transition-all active:scale-95 flex items-center gap-2"><PlayIcon className="w-5 h-5"/> Preview</button></div></footer>
                </div>
            )}

            {isPlaying && (
                <div className="fixed inset-0 bg-black z-[100] flex flex-col items-center justify-center animate-fade-in group/theater">
                    <button onClick={() => setIsPlaying(false)} className="absolute top-10 right-10 text-white bg-black/40 hover:bg-red-600/90 p-4 rounded-full z-[110] backdrop-blur-xl border border-white/10 shadow-2xl"><XIcon className="w-10 h-10"/></button>
                    <div className="w-full h-full relative flex items-center justify-center overflow-hidden">
                        {mediaWithTimestamps.map((media, index) => {
                            const isVisible = index === currentSlide;
                            const isPreloading = index === currentSlide + 1 || (settings.repeatSlideshow && currentSlide === mediaWithTimestamps.length - 1 && index === 0);
                            if (!isVisible && !isPreloading) return null;
                            return <TheaterMedia key={media.id} media={media as any} isVisible={isVisible} isPreloading={isPreloading} muteVideos={settings.muteVideos} elapsedTime={elapsedTime} slideStyle={settings.slideStyle} />;
                        })}
                        {settings.showCaptions && ((mediaWithTimestamps[currentSlide] as any)?.caption || (mediaWithTimestamps[currentSlide] as any)?.aiCaption) && (
                            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-black/20 backdrop-blur-md px-10 py-4 rounded-2xl border border-white/5 text-center w-[85%] max-w-5xl shadow-2xl z-50 pointer-events-none"><p className="text-white text-base md:text-xl font-medium drop-shadow-lg italic">{(mediaWithTimestamps[currentSlide] as any).caption || (mediaWithTimestamps[currentSlide] as any).aiCaption}</p></div>
                        )}
                    </div>
                    {audioFiles.map((a) => {
                        const isActive = elapsedTime >= a.startTime && elapsedTime < (a.startTime + a.duration);
                        const inTime = elapsedTime - a.startTime;
                        let vol = isActive ? (a.fadeIn > 0 && inTime < a.fadeIn ? inTime / a.fadeIn : (a.fadeOut > 0 && inTime > (a.duration - a.fadeOut) ? (a.duration - inTime) / a.fadeOut : 1.0)) * getDuckingFactor(elapsedTime) : 0;
                        if (a.source === 'apple-music') return <AppleMusicPlayer key={a.id} trackId={a.appleMusicTrackId!} active={isActive} volume={vol} startTimeInFile={inTime} isDemo={isDemoMode} />;
                        return <AudioPlayer key={a.id} src={a.previewUrl} active={isActive} volume={vol} startTimeInFile={inTime} />;
                    })}
                </div>
            )}
            
            <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(109, 40, 217, 0.4); border-radius: 20px; } input[type='range'] { -webkit-appearance: none; appearance: none; background: transparent; cursor: pointer; } input[type='range']::-webkit-slider-runnable-track { background: rgba(255,255,255,0.1); height: 0.25rem; border-radius: 0.5rem; } input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; margin-top: -6px; background-color: #6d28d9; height: 1rem; width: 1rem; border-radius: 9999px; box-shadow: 0 0 10px rgba(109, 40, 217, 0.5); border: 2px solid white; }`}</style>
        </div>
    );
};

export default App;