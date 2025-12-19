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
    serverData?: { url: string; storagePath: string; };
}

interface SlideshowSettings {
    interval: number;
    slideStyle: string;
    showClock: boolean;
    smartCaptionsEnabled: boolean;
    repeatSlideshow: boolean;
    showCaptions: boolean;
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

// --- ICON COMPONENTS ---
const UploadIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>;
const MusicIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-13c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>;
const PlayIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const XIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
const PlusIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>;
const TrashIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>;
const AdjustmentIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>;
const ShareIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>;
const DuplicateIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>;
const SparklesIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>;
const SettingsIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
const ChevronLeftIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>;
const ChevronRightIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>;
const BeakerIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.673.337a4 4 0 01-2.506.326l-1.741-.348a2 2 0 11.774-3.925l1.74.348a6 6 0 003.759-.488l.673-.337a8 8 0 015.147-.689l2.387.477a4 4 0 012.988 4.766l-1.054 5.27a2 2 0 01-3.126 1.264l-2.383-1.588a4 4 0 00-4.431 0l-2.383 1.588a2 2 0 01-3.126-1.264l1.054-5.27a4 4 0 00-.747-3.411L3.834 11a2 2 0 011.264-3.126l5.27-1.054a4 4 0 003.411-.747l2.126-2.126a2 2 0 013.126 1.264l1.054 5.27a4 4 0 00.747 3.411l2.126 2.126a2 2 0 01.126 2.701z" /></svg>;

// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
    const [user, setUser] = useState<User | null>(null);
    const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
    const [audioFiles, setAudioFiles] = useState<AppStateAudio[]>([]);
    const [settings, setSettings] = useState<SlideshowSettings>({
        interval: 5, slideStyle: 'ken-burns', showClock: true, smartCaptionsEnabled: false, repeatSlideshow: false, showCaptions: true,
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
    
    // Sharing State
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [shareSlideshowTarget, setShareSlideshowTarget] = useState<SavedSlideshow | null>(null);
    const [shareEmail, setShareEmail] = useState('');
    const [shareRole, setShareRole] = useState<'viewer' | 'editor'>('viewer');

    const videoPreviewRef = useRef<HTMLVideoElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const playbackTimerRef = useRef<any>(null);

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

    const resetWorkspace = useCallback(() => {
        setMediaFiles([]);
        setAudioFiles([]);
        setSlideshowName('');
        setCurrentSlideshowId(null);
        setError(null);
        setCurrentSlide(0);
        setIsPlaying(false);
        setElapsedTime(0);
    }, []);

    const userPermission = useMemo(() => {
        if (!user || !currentSlideshowId) return 'owner';
        const found = ownedSlideshows.find(s => s.id === currentSlideshowId);
        if (found) return 'owner';
        const shared = sharedWithMeSlideshows.find(s => s.id === currentSlideshowId);
        if (shared) {
            const myCollab = shared.collaborators?.find(c => c.email.toLowerCase() === user.email?.toLowerCase());
            return myCollab?.role || 'viewer';
        }
        return 'owner';
    }, [user, currentSlideshowId, ownedSlideshows, sharedWithMeSlideshows]);

    const canEdit = userPermission === 'owner' || userPermission === 'editor';

    // AUTH LISTENER
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => { 
            setUser(u); 
            if (!u) {
                resetWorkspace();
            }
            setIsLoading(false); 
        });
        return unsubscribe;
    }, [resetWorkspace]);

    // REAL-TIME DATABASE LISTENERS
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
        const unsubOwned = onSnapshot(qOwned, 
            (snap) => {
                setOwnedSlideshows(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow)));
                setIsFetchingData(false);
            },
            (err) => {
                console.error("Firestore Owned Fetch Error:", err);
                setError("Gallery sync failed.");
                setIsFetchingData(false);
            }
        );

        const qShared = query(slideshowsRef, where("collaboratorEmails", "array-contains", stableUserEmail));
        const unsubShared = onSnapshot(qShared, 
            (snap) => {
                setSharedWithMeSlideshows(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow)));
            },
            (err) => {
                console.error("Firestore Shared Fetch Error:", err);
            }
        );

        return () => { 
            unsubOwned(); 
            unsubShared(); 
        };
    }, [user?.uid, user?.email]); 

    const allSlideshows = useMemo(() => {
        const combined = [...ownedSlideshows, ...sharedWithMeSlideshows];
        const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
        return unique.sort((a, b) => {
            const tA = getMillis(a.timestamp) || getMillis(a.createdAt) || 0;
            const tB = getMillis(b.timestamp) || getMillis(b.createdAt) || 0;
            return tB - tA;
        });
    }, [ownedSlideshows, sharedWithMeSlideshows]);

    // Enhanced Playback Engine
    useEffect(() => {
        if (!isPlaying) {
            if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
            return;
        }

        const TICK = 50; 
        playbackTimerRef.current = setInterval(() => {
            setElapsedTime(prev => {
                const next = prev + (TICK / 1000);
                if (next >= totalSlideshowDuration) {
                    if (settings.repeatSlideshow) return 0;
                    setIsPlaying(false);
                    return 0;
                }
                return next;
            });
        }, TICK);

        return () => clearInterval(playbackTimerRef.current);
    }, [isPlaying, totalSlideshowDuration, settings.repeatSlideshow]);

    // Update currentSlide based on elapsedTime
    useEffect(() => {
        const activeIdx = mediaWithTimestamps.findIndex(m => elapsedTime >= m.timelineStart && elapsedTime < m.timelineEnd);
        if (activeIdx !== -1 && activeIdx !== currentSlide) {
            setCurrentSlide(activeIdx);
        }
    }, [elapsedTime, mediaWithTimestamps, currentSlide]);

    const generateSmartCaptions = async () => {
        if (!settings.smartCaptionsEnabled) return;
        setIsProcessing(true);
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        try {
            const updatedMedia = await Promise.all(mediaFiles.map(async (m) => {
                if (m.type === 'image' && !m.caption && !m.aiCaption) {
                    let base64Data = '';
                    if (m.file) {
                        base64Data = await fileToBase64(m.file);
                    } else if (m.serverData) {
                        base64Data = await urlToBase64(m.serverData.url);
                    }

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
        } catch (e) {
            console.error("AI Generation Error", e);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleLogin = async () => {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        try { 
            await signInWithPopup(auth, provider); 
            resetWorkspace();
        } catch (e: any) { 
            setError("Sign in failed: " + e.message); 
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const files = (Array.from(e.target.files) as File[]).slice(0, 20 - mediaFiles.length);
        const resolved: MediaFile[] = [];
        
        for (const f of files) {
            const isImg = f.type.startsWith('image/');
            const dur = isImg ? 0 : await getMediaDuration(f);
            
            if (!isImg && dur > 45) {
                setError(`Video "${f.name}" is too long. Maximum allowed duration is 45 seconds.`);
                continue;
            }

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
        setAudioFiles(p => [...p, { id: `a-${Date.now()}`, file, name: file.name, duration, startTime: 0, fadeIn: 1, fadeOut: 1 }]);
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
        setIsSaving(true);
        setError(null);
        try {
            const id = currentSlideshowId || doc(collection(db, 'slideshows')).id;
            
            const serMedia = [];
            for (const m of mediaFiles) {
                const b: any = { id: m.id, type: m.type, name: m.id, rotation: m.rotation, caption: (m as any).caption, aiCaption: (m as any).aiCaption, duration: (m as any).duration, volume: (m as any).volume, duckBGM: (m as any).duckBGM };
                if (!m.serverData && m.file) {
                    const path = `users/${user.uid}/${id}/${m.id}`;
                    await uploadBytes(ref(storage, path), m.file);
                    b.url = await getDownloadURL(ref(storage, path));
                    b.storagePath = path;
                } else {
                    b.url = m.serverData?.url; 
                    b.storagePath = m.serverData?.storagePath;
                }
                serMedia.push(b);
            }

            const serAudio = [];
            for (const a of audioFiles) {
                const b: any = { id: a.id, name: a.name, duration: a.duration, startTime: a.startTime, fadeIn: a.fadeIn, fadeOut: a.fadeOut };
                if (!a.serverData && a.file) {
                    const path = `users/${user.uid}/${id}/a-${a.id}`;
                    await uploadBytes(ref(storage, path), a.file);
                    b.url = await getDownloadURL(ref(storage, path));
                    b.storagePath = path;
                } else {
                    b.url = a.serverData?.url; 
                    b.storagePath = a.serverData?.storagePath;
                }
                serAudio.push(b);
            }
            
            const existing = allSlideshows.find(s => s.id === id);
            const collaborators = existing?.collaborators || [];
            const ownerEmail = user.email.toLowerCase();
            const collaboratorEmails = Array.from(new Set([
                ownerEmail,
                ...collaborators.map(c => c.email.toLowerCase())
            ]));

            await setDoc(doc(db, 'slideshows', id), {
                userId: existing?.userId || user.uid,
                userEmail: existing?.userEmail || user.email,
                name: slideshowName || 'My Slideshow', 
                media: serMedia, 
                audio: serAudio,
                settings, 
                totalDuration: totalSlideshowDuration, 
                timestamp: serverTimestamp(), 
                createdAt: existing?.createdAt || serverTimestamp(),
                collaborators: collaborators,
                collaboratorEmails: collaboratorEmails
            }, { merge: true });
            
            setCurrentSlideshowId(id);
        } catch (e: any) { 
            console.error("Save Error", e);
            setError("Cloud save failed: " + e.message); 
        } finally { 
            setIsSaving(false); 
        }
    };

    const handleLoad = (s: SavedSlideshow) => {
        setIsPlaying(false);
        setCurrentSlide(0);
        setElapsedTime(0);

        setMediaFiles((s.media || []).map(m => ({ 
            id: m.id, 
            type: m.type as any, 
            previewUrl: m.url, 
            rotation: m.rotation || 0, 
            caption: m.caption || '', 
            aiCaption: m.aiCaption || '', 
            duration: m.duration || 0, 
            volume: m.volume ?? 1.0,
            duckBGM: m.duckBGM ?? true,
            serverData: { url: m.url, storagePath: m.storagePath } 
        })));

        setAudioFiles((s.audio || []).map((a, i) => ({ 
            id: a.id || `l-${i}`, 
            name: a.name, 
            duration: a.duration || 0, 
            startTime: a.startTime || 0, 
            fadeIn: a.fadeIn || 1, 
            fadeOut: a.fadeOut || 1, 
            serverData: { url: a.url, storagePath: a.storagePath } 
        })));

        if (s.settings) setSettings(s.settings); 
        if (s.name) setSlideshowName(s.name); 
        setCurrentSlideshowId(s.id);
        setError(null);
    };

    const handleClone = async (s: SavedSlideshow) => {
        if (!user || !user.email) return;
        setIsProcessing(true);
        try {
            const cloneName = `Copy of ${s.name}`;
            const newDocRef = await addDoc(collection(db, 'slideshows'), {
                userId: user.uid,
                userEmail: user.email,
                name: cloneName,
                media: s.media,
                audio: s.audio,
                settings: s.settings,
                totalDuration: s.totalDuration,
                timestamp: serverTimestamp(),
                createdAt: serverTimestamp(),
                collaborators: [],
                collaboratorEmails: [user.email.toLowerCase()]
            });
            setError(`Project cloned as "${cloneName}"!`);
        } catch (e: any) {
            setError("Cloning failed: " + e.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDelete = async (s: SavedSlideshow) => {
        if (!user || s.userId !== user.uid) return;
        if (!window.confirm(`Delete "${s.name}"? This cannot be undone.`)) return;
        setIsProcessing(true);
        try {
            await deleteDoc(doc(db, 'slideshows', s.id));
            if (currentSlideshowId === s.id) resetWorkspace();
        } catch (e: any) { 
            setError("Deletion error: " + e.message); 
        } finally { 
            setIsProcessing(false); 
        }
    };

    const startPlayback = async () => {
        if (mediaFiles.length === 0) return;
        if (settings.smartCaptionsEnabled) {
            await generateSmartCaptions();
        }
        setElapsedTime(0);
        setCurrentSlide(0);
        setIsPlaying(true);
    };

    const handleShareSlideshow = async () => {
        if (!shareSlideshowTarget || !shareEmail) return;
        const normalizedEmail = shareEmail.trim().toLowerCase();
        setIsProcessing(true);
        try {
            const updatedCollabs = [...(shareSlideshowTarget.collaborators || []), { email: normalizedEmail, role: shareRole }];
            const updatedEmails = Array.from(new Set([...(shareSlideshowTarget.collaboratorEmails || []), normalizedEmail]));
            
            await setDoc(doc(db, 'slideshows', shareSlideshowTarget.id), { 
                collaborators: updatedCollabs,
                collaboratorEmails: updatedEmails
            }, { merge: true });
            
            setShareSlideshowTarget({ ...shareSlideshowTarget, collaborators: updatedCollabs, collaboratorEmails: updatedEmails });
            setShareEmail('');
            setError(`Shared with ${normalizedEmail}!`);
        } catch (e: any) { 
            setError("Sharing failed: " + e.message); 
        } finally { 
            setIsProcessing(false); 
        }
    };

    const removeCollaborator = async (email: string) => {
        if (!shareSlideshowTarget) return;
        setIsProcessing(true);
        try {
            const updatedCollabs = (shareSlideshowTarget.collaborators || []).filter(c => c.email !== email);
            const ownerEmail = shareSlideshowTarget.userEmail?.toLowerCase() || "";
            const updatedEmails = Array.from(new Set([
                ownerEmail,
                ...updatedCollabs.map(c => c.email.toLowerCase())
            ])).filter(Boolean);
            
            await setDoc(doc(db, 'slideshows', shareSlideshowTarget.id), { 
                collaborators: updatedCollabs,
                collaboratorEmails: updatedEmails
            }, { merge: true });
            
            setShareSlideshowTarget({ ...shareSlideshowTarget, collaborators: updatedCollabs, collaboratorEmails: updatedEmails });
        } catch (e: any) { 
            setError("Removal failed: " + e.message); 
        } finally { 
            setIsProcessing(false); 
        }
    };

    // Intelligent Ducking Calculation
    const getDuckingFactor = useCallback((time: number) => {
        const FADE_TIME = 0.8;
        const DUCK_LEVEL = 0.15;
        
        const segment = mediaWithTimestamps.find(m => 
            m.type === 'video' && 
            (m as VideoFile).duckBGM && 
            time >= m.timelineStart && 
            time < m.timelineEnd
        );

        if (!segment) return 1.0;

        const timeIn = time - segment.timelineStart;
        const timeOut = segment.timelineEnd - time;

        const segIdx = mediaWithTimestamps.indexOf(segment);
        const prevSeg = segIdx > 0 ? mediaWithTimestamps[segIdx - 1] : null;
        const nextSeg = segIdx < mediaWithTimestamps.length - 1 ? mediaWithTimestamps[segIdx + 1] : null;

        const prevIsDucking = prevSeg?.type === 'video' && (prevSeg as VideoFile).duckBGM;
        const nextIsDucking = nextSeg?.type === 'video' && (nextSeg as VideoFile).duckBGM;

        let duckFactor = DUCK_LEVEL;

        if (!prevIsDucking && timeIn < FADE_TIME) {
            const progress = timeIn / FADE_TIME;
            duckFactor = 1.0 - (progress * (1.0 - DUCK_LEVEL));
        }
        
        if (!nextIsDucking && timeOut < FADE_TIME) {
            const progress = timeOut / FADE_TIME;
            const endRamp = 1.0 - (progress * (1.0 - DUCK_LEVEL));
            duckFactor = Math.max(duckFactor, endRamp);
        }

        return duckFactor;
    }, [mediaWithTimestamps]);

    if (isLoading) return (
        <div className="min-h-screen bg-brand-dark flex items-center justify-center">
            <div className="w-12 h-12 border-4 border-brand-purple border-t-transparent rounded-full animate-spin"></div>
        </div>
    );

    return (
        <div className={`min-h-screen font-sans ${user ? 'bg-brand-dark text-gray-200' : 'bg-white text-gray-900'}`}>
            {(isSaving || isProcessing) && (
                <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center backdrop-blur-sm">
                    <div className="text-center p-8 bg-gray-900/80 rounded-[2rem] border border-gray-800 shadow-2xl">
                        <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-brand-purple mx-auto"></div>
                        <p className="text-white text-xl mt-6 font-black tracking-tight uppercase">Processing...</p>
                    </div>
                </div>
            )}

            <header className={`p-4 flex justify-between items-center border-b sticky top-0 z-40 backdrop-blur-md ${user ? 'bg-gray-900/50 border-gray-800' : 'bg-white/90 border-gray-100'}`}>
                <h1 className="text-2xl font-bold tracking-tight"><span className="text-brand-purple">Muziq</span> Slides</h1>
                <div className="flex gap-4 items-center">
                    {user && <div className="hidden sm:flex flex-col items-end">
                        <span className="text-xs text-white font-medium">{user.displayName || user.email}</span>
                    </div>}
                    {user ? (
                        <div className="flex gap-2">
                            <button onClick={handleLogin} className="bg-gray-800 text-white py-2 px-4 rounded-lg text-sm font-bold shadow-sm transition-all hover:bg-gray-700 border border-gray-700">Switch Account</button>
                            <button onClick={() => signOut(auth)} className="bg-gray-200 text-gray-900 py-2 px-6 rounded-lg text-sm font-bold shadow-sm transition-all hover:bg-gray-300">Logout</button>
                        </div>
                    ) : (
                        <button onClick={handleLogin} className="bg-brand-purple text-white py-2 px-6 rounded-lg text-sm font-bold shadow-md transition-all hover:bg-purple-700">Sign In</button>
                    )}
                </div>
            </header>

            {!user ? (
                <main className="animate-fade-in text-center py-20 px-4">
                    <h2 className="text-5xl font-extrabold mb-6 leading-tight">Turn Memories into <br/><span className="text-brand-purple">Masterpieces</span></h2>
                    <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto font-medium">Create beautiful photo slideshows with your favorite music. Perfect for Roku or Amazon Fire TV screensavers.</p>
                    <button onClick={handleLogin} className="bg-brand-purple text-white py-4 px-12 rounded-full text-lg font-bold shadow-xl hover:scale-105 transition-transform active:scale-95">Get Started</button>
                </main>
            ) : (
                <main className="p-4 sm:p-8 grid lg:grid-cols-2 gap-8 max-w-7xl mx-auto">
                    <div className="space-y-6">
                        {error && (
                            <div className="bg-red-500/20 border border-red-500/40 text-red-200 px-4 py-4 rounded-2xl text-sm flex justify-between items-center animate-fade-in">
                                <span className="font-medium">{error}</span>
                                <button onClick={() => setError(null)} className="p-1"><XIcon className="w-5 h-5"/></button>
                            </div>
                        )}

                        <section className="bg-gray-800/40 p-6 rounded-[2.5rem] border border-gray-700/50 shadow-2xl">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-white uppercase tracking-tighter"><UploadIcon className="w-5 h-5 text-brand-purple"/> 1. Upload & Organize</h3>
                            <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-gray-700 rounded-[1.5rem] p-8 text-center cursor-pointer hover:border-brand-purple hover:bg-brand-purple/5 transition-all group">
                                <UploadIcon className="w-12 h-12 mx-auto text-gray-500 mb-2 group-hover:scale-110 transition-transform group-hover:text-brand-purple"/>
                                <p className="text-sm text-gray-400 font-bold">Upload Photos or Videos (Max 20)</p>
                            </div>
                            <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept="image/*,video/*" className="hidden" />
                            
                            <div className="mt-4 grid grid-cols-4 gap-3">
                                {mediaFiles.map((m, idx) => (
                                    <div key={m.id} className="aspect-square bg-black rounded-2xl overflow-hidden relative group border border-gray-700 shadow-lg">
                                        {m.type === 'image' ? (
                                            <img src={m.previewUrl} className="w-full h-full object-cover transition-transform group-hover:scale-110" alt="preview" />
                                        ) : (
                                            <div className="w-full h-full relative">
                                                <video src={m.previewUrl} className="w-full h-full object-cover opacity-60" muted />
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <PlayIcon className="w-8 h-8 text-white opacity-80" />
                                                </div>
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                                            <div className="flex justify-end">
                                                <button onClick={() => setMediaFiles(p => p.filter(x => x.id !== m.id))} className="bg-red-600/90 p-1 rounded-lg hover:bg-red-500 transition-colors"><XIcon className="w-4 h-4 text-white"/></button>
                                            </div>
                                            <div className="flex justify-between items-center gap-1">
                                                <button onClick={() => moveMedia(idx, 'left')} disabled={idx === 0} className="bg-white/20 p-1.5 rounded-lg backdrop-blur-md hover:bg-white/40 disabled:opacity-20"><ChevronLeftIcon className="w-4 h-4 text-white"/></button>
                                                <span className="text-[10px] font-black text-white bg-brand-purple/60 px-2 py-0.5 rounded-full">{idx + 1}</span>
                                                <button onClick={() => moveMedia(idx, 'right')} disabled={idx === mediaFiles.length - 1} className="bg-white/20 p-1.5 rounded-lg backdrop-blur-md hover:bg-white/40 disabled:opacity-20"><ChevronRightIcon className="w-4 h-4 text-white"/></button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="bg-gray-800/40 p-6 rounded-[2.5rem] border border-gray-700/50 shadow-2xl">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-white uppercase tracking-tighter"><MusicIcon className="w-5 h-5 text-brand-purple"/> 2. Add Music</h3>
                            <button onClick={() => audioInputRef.current?.click()} className="w-full bg-gray-700/30 hover:bg-gray-700/50 py-4 rounded-2xl font-black text-sm flex justify-center gap-2 border border-gray-600/50 transition-all uppercase tracking-widest"><PlusIcon className="w-5 h-5"/> Add Audio Track</button>
                            <input type="file" ref={audioInputRef} onChange={handleAudioChange} accept="audio/*" className="hidden" />
                            <div className="mt-4 space-y-2">
                                {audioFiles.map(a => <div key={a.id} className="bg-gray-900/40 p-5 rounded-2xl flex justify-between items-center text-sm font-medium border border-gray-700/50 group"><span>{a.name} <span className="text-gray-500 font-bold ml-2">({formatDuration(a.duration)})</span></span><button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))}><TrashIcon className="w-5 h-5 text-red-400 opacity-0 group-hover:opacity-100 transition-all"/></button></div>)}
                            </div>
                        </section>

                        <section className="bg-gray-800/40 p-6 rounded-[2.5rem] border border-gray-700/50 shadow-2xl">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-white uppercase tracking-tighter"><SettingsIcon className="w-5 h-5 text-brand-purple"/> 3. Slideshow Settings</h3>
                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                        <label className="text-xs text-gray-500 font-black uppercase tracking-widest">Slide Duration (Seconds)</label>
                                        <span className="text-brand-purple font-black text-sm">{settings.interval}s</span>
                                    </div>
                                    <input type="range" min="1" max="45" value={settings.interval} onChange={e => setSettings(s => ({...s, interval: +e.target.value}))} className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-purple" />
                                </div>
                                <div className="space-y-3">
                                    <label className="text-xs text-gray-500 font-black uppercase tracking-widest block">Transition Style</label>
                                    <select 
                                        value={settings.slideStyle} 
                                        onChange={e => setSettings(s => ({...s, slideStyle: e.target.value}))}
                                        className="w-full bg-gray-900/50 border border-gray-700/50 rounded-2xl px-5 py-3 text-sm text-white font-bold focus:ring-2 focus:ring-brand-purple outline-none appearance-none cursor-pointer transition-all"
                                    >
                                        <option value="ken-burns">Ken Burns (Pan & Zoom)</option>
                                        <option value="fade-in">Classic Fade</option>
                                        <option value="slide-from-right">Side Slide</option>
                                        <option value="slide-from-bottom">Bottom Entry</option>
                                        <option value="zoom-in">Focus Zoom</option>
                                        <option value="zoom-out">Deep Pull</option>
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <label className="flex items-center gap-3 cursor-pointer group bg-gray-900/20 p-4 rounded-2xl border border-gray-800 hover:border-brand-purple/50 transition-all">
                                        <input type="checkbox" className="w-4 h-4 accent-brand-purple" checked={settings.repeatSlideshow} onChange={() => setSettings(s => ({...s, repeatSlideshow: !s.repeatSlideshow}))} />
                                        <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Loop Slideshow</span>
                                    </label>
                                    <label className="flex items-center gap-3 cursor-pointer group bg-gray-900/20 p-4 rounded-2xl border border-gray-800 hover:border-brand-purple/50 transition-all">
                                        <input type="checkbox" className="w-4 h-4 accent-brand-purple" checked={settings.smartCaptionsEnabled} onChange={() => setSettings(s => ({...s, smartCaptionsEnabled: !s.smartCaptionsEnabled}))} />
                                        <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Smart Captions</span>
                                    </label>
                                </div>
                            </div>
                        </section>
                    </div>

                    <div className="space-y-6">
                        <section className="bg-gray-800/40 p-6 rounded-[2.5rem] border border-gray-700/50 shadow-2xl">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-bold flex items-center gap-2 text-white uppercase tracking-tighter"><PlayIcon className="w-5 h-5 text-brand-purple"/> 4. Preview Theater</h3>
                                {canEdit && (
                                    <button 
                                        onClick={() => setIsAdvancedEditorOpen(true)}
                                        className="text-[10px] bg-brand-purple/20 hover:bg-brand-purple/40 text-brand-purple px-4 py-2 rounded-xl font-black uppercase tracking-widest border border-brand-purple/30 transition-all flex items-center gap-2"
                                    >
                                        <BeakerIcon className="w-4 h-4"/> Advanced Studio
                                    </button>
                                )}
                            </div>
                            <div className="aspect-video bg-black rounded-[2rem] relative flex items-center justify-center overflow-hidden border border-gray-700/50 shadow-2xl group">
                                {mediaFiles.length > 0 ? (
                                    <>
                                        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                                            {mediaFiles[0].type === 'image' ? (
                                                <img src={mediaFiles[0].previewUrl} className="w-full h-full object-cover blur-2xl opacity-20" alt="bg" />
                                            ) : (
                                                <video src={mediaFiles[0].previewUrl} className="w-full h-full object-cover blur-2xl opacity-20" muted />
                                            )}
                                        </div>
                                        <button onClick={startPlayback} className="relative z-10 flex items-center justify-center bg-brand-purple p-8 rounded-full shadow-2xl hover:scale-110 active:scale-95 transition-all"><PlayIcon className="w-16 h-16 text-white"/></button>
                                        <div className="absolute bottom-4 left-4 text-[10px] font-black uppercase tracking-[0.2em] text-white/40">{mediaFiles.length} Assets Loaded</div>
                                    </>
                                ) : <p className="text-gray-600 font-black uppercase tracking-[0.2em] italic">No Media Assets</p>}
                            </div>
                        </section>

                        <section className="bg-gray-800/40 p-6 rounded-[2.5rem] border border-gray-700/50 shadow-2xl">
                            <h3 className="text-lg font-bold mb-4 text-white uppercase tracking-tighter">5. Project Archive</h3>
                            <div className="flex gap-2 mb-6">
                                <input value={slideshowName} onChange={e => setSlideshowName(e.target.value)} placeholder="Name your project..." className="flex-1 bg-gray-900/40 rounded-2xl px-5 py-4 border border-gray-700/50 outline-none focus:ring-2 focus:ring-brand-purple font-bold text-white shadow-inner" />
                                <button 
                                    onClick={handleSave} 
                                    disabled={isSaving || !canEdit} 
                                    className={`px-8 rounded-2xl font-black text-sm uppercase tracking-widest transition-all ${canEdit ? 'bg-brand-purple hover:bg-purple-700 shadow-brand-purple/20' : 'bg-gray-700 opacity-50'}`}>
                                    {isSaving ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                            
                            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                                {isFetchingData ? (
                                    <div className="py-12 text-center text-gray-500 uppercase text-[10px] tracking-widest">Fetching Gallery...</div>
                                ) : allSlideshows.length > 0 ? allSlideshows.map(s => (
                                    <div key={s.id} className={`bg-gray-900/30 p-5 rounded-[1.5rem] flex flex-col sm:flex-row justify-between items-start sm:items-center group border transition-all gap-4 ${currentSlideshowId === s.id ? 'border-brand-purple bg-brand-purple/10' : 'border-gray-800/50 hover:border-gray-600'}`}>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-black text-sm text-white truncate uppercase tracking-tight">{s.name}</h4>
                                            <div className="flex gap-3 mt-1">
                                                <p className="text-[9px] text-gray-500 font-bold uppercase">{formatDuration(s.totalDuration || 0)}</p>
                                                <p className="text-[9px] text-gray-400 font-bold uppercase">• {s.media?.length || 0} Media</p>
                                                {s.userId !== user?.uid && <p className="text-[9px] text-brand-purple font-black uppercase underline">Shared with me</p>}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <button onClick={() => handleLoad(s)} className="text-[9px] bg-white text-black py-2 px-5 rounded-xl font-black uppercase tracking-widest hover:scale-105 transition-transform active:scale-95 shadow-xl">Load</button>
                                            
                                            <div className="flex items-center bg-black/40 rounded-xl border border-gray-800 p-0.5">
                                                <button title="Clone Project" onClick={() => handleClone(s)} className="p-2 text-gray-400 hover:text-white transition-colors"><DuplicateIcon className="w-4 h-4"/></button>
                                                <button title="Share Slideshow" onClick={() => { setShareSlideshowTarget(s); setIsShareModalOpen(true); }} className="p-2 text-gray-400 hover:text-white transition-colors"><ShareIcon className="w-4 h-4"/></button>
                                                {s.userId === user?.uid && (
                                                    <button title="Delete Project" onClick={() => handleDelete(s)} className="p-2 text-gray-400 hover:text-red-500 transition-colors"><TrashIcon className="w-4 h-4"/></button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )) : (
                                    <div className="text-center py-12 text-gray-600 font-black text-xs uppercase tracking-widest border border-dashed border-gray-800 rounded-3xl">Archive Empty</div>
                                )}
                            </div>
                        </section>
                    </div>
                </main>
            )}

            {isShareModalOpen && shareSlideshowTarget && (
                <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4 animate-fade-in backdrop-blur-md">
                    <div className="bg-gray-900 w-full max-w-md rounded-[2.5rem] border border-gray-800 shadow-2xl flex flex-col p-8">
                        <div className="flex justify-between items-center mb-8">
                            <div>
                                <h2 className="text-xl font-black uppercase tracking-tighter">Share Project</h2>
                                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">Project: {shareSlideshowTarget.name}</p>
                            </div>
                            <button onClick={() => setIsShareModalOpen(false)} className="text-gray-500 hover:text-white"><XIcon className="w-8 h-8"/></button>
                        </div>
                        <div className="space-y-6">
                            <div className="flex gap-2">
                                <input 
                                    value={shareEmail} 
                                    onChange={e => setShareEmail(e.target.value)} 
                                    placeholder="email@example.com" 
                                    className="flex-1 bg-gray-950 border border-gray-800 rounded-2xl px-5 py-4 text-sm font-bold text-white shadow-inner outline-none focus:ring-1 focus:ring-brand-purple" 
                                />
                                <button onClick={handleShareSlideshow} className="bg-brand-purple text-white px-5 py-4 rounded-2xl hover:bg-purple-700 active:scale-90 transition-all"><PlusIcon className="w-6 h-6"/></button>
                            </div>
                            <div className="max-h-60 overflow-y-auto space-y-3 custom-scrollbar pr-2">
                                <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest">Collaborators</p>
                                <div className="bg-gray-800/30 p-4 rounded-2xl border border-gray-700/50 flex justify-between items-center">
                                    <div className="flex flex-col">
                                        <span className="text-sm font-black text-white">{shareSlideshowTarget.userEmail || 'Owner'}</span>
                                        <span className="text-[8px] text-gray-500 font-bold uppercase">Original Creator</span>
                                    </div>
                                    <span className="text-[9px] text-brand-purple font-black uppercase tracking-widest bg-brand-purple/10 px-2 py-0.5 rounded-full">Owner</span>
                                </div>
                                {shareSlideshowTarget.collaborators?.map(c => (
                                    <div key={c.email} className="bg-gray-800/30 p-4 rounded-2xl border border-gray-700/50 flex justify-between items-center group">
                                        <span className="text-sm font-black text-white">{c.email}</span>
                                        {user?.uid === shareSlideshowTarget.userId && (
                                            <button onClick={() => removeCollaborator(c.email)} className="text-gray-600 hover:text-red-400 transition-colors"><TrashIcon className="w-4 h-4"/></button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {isAdvancedEditorOpen && (
                <div className="fixed inset-0 bg-brand-dark z-[100] flex flex-col p-6 animate-fade-in overflow-hidden">
                    <header className="flex justify-between items-center mb-8 shrink-0">
                        <div>
                            <h2 className="text-3xl font-black uppercase tracking-tighter flex items-center gap-4"><BeakerIcon className="w-8 h-8 text-brand-purple"/> Advanced Studio</h2>
                            <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">Multi-Track Timeline Editor</p>
                        </div>
                        <button onClick={() => setIsAdvancedEditorOpen(false)} className="bg-gray-800 hover:bg-gray-700 p-4 rounded-full transition-all border border-gray-700 shadow-xl"><XIcon className="w-6 h-6"/></button>
                    </header>

                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-8 pr-2 pb-20">
                        <div className="bg-gray-950/50 rounded-3xl p-6 border border-gray-800/50 shadow-2xl relative">
                            <div className="absolute top-0 left-[180px] right-6 h-6 border-b border-gray-800 flex justify-between px-1">
                                {Array.from({ length: Math.ceil(totalSlideshowDuration / 5) + 1 }).map((_, i) => (
                                    <span key={i} className="text-[8px] text-gray-600 font-black">{i * 5}s</span>
                                ))}
                            </div>

                            <div className="space-y-6 mt-4">
                                <div className="flex gap-4 group">
                                    <div className="w-40 shrink-0 bg-gray-900 p-4 rounded-2xl border border-gray-800 flex flex-col justify-center">
                                        <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Track 1: Visuals</span>
                                        <span className="text-[8px] text-brand-purple font-bold">Images & Clips</span>
                                    </div>
                                    <div className="flex-1 h-20 bg-gray-950/40 rounded-2xl border border-gray-800/50 flex relative overflow-x-auto custom-scrollbar">
                                        {mediaWithTimestamps.map((m, idx) => (
                                            <div 
                                                key={m.id} 
                                                className={`h-full border-r border-gray-800 relative transition-all group/clip overflow-hidden ${m.type === 'image' ? 'bg-brand-purple/10' : 'bg-blue-500/10'}`}
                                                style={{ width: `${(m.timelineEnd - m.timelineStart) * 20}px`, minWidth: '40px' }}
                                            >
                                                {m.type === 'image' ? <img src={m.previewUrl} className="w-full h-full object-cover opacity-30"/> : <video src={m.previewUrl} className="w-full h-full object-cover opacity-30" muted/>}
                                                <div className="absolute inset-0 flex flex-col items-center justify-center p-1 pointer-events-none">
                                                    <span className="text-[8px] font-black text-white/40 uppercase whitespace-nowrap">{m.type} #{idx+1}</span>
                                                    <span className="text-[8px] font-bold text-white/20 whitespace-nowrap">{formatDuration(m.timelineEnd - m.timelineStart)}</span>
                                                </div>
                                                {m.type === 'video' && (
                                                    <div className="absolute bottom-1 left-1 flex gap-1 opacity-0 group-hover/clip:opacity-100 transition-opacity pointer-events-auto">
                                                        <button 
                                                            onClick={() => {
                                                                const updated = [...mediaFiles];
                                                                (updated[idx] as VideoFile).duckBGM = !(updated[idx] as VideoFile).duckBGM;
                                                                setMediaFiles(updated);
                                                            }}
                                                            className={`text-[7px] px-1 rounded font-black uppercase tracking-tighter ${(m as VideoFile).duckBGM ? 'bg-brand-purple text-white' : 'bg-gray-800 text-gray-400'}`}
                                                        >
                                                            Duck BGM: {(m as VideoFile).duckBGM ? 'ON' : 'OFF'}
                                                        </button>
                                                        <input 
                                                            type="range" min="0" max="1" step="0.1" 
                                                            value={(m as VideoFile).volume}
                                                            onChange={e => {
                                                                const updated = [...mediaFiles];
                                                                (updated[idx] as VideoFile).volume = parseFloat(e.target.value);
                                                                setMediaFiles(updated);
                                                            }}
                                                            className="w-10 accent-brand-purple h-2"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex gap-4">
                                    <div className="w-40 shrink-0 bg-gray-900 p-4 rounded-2xl border border-gray-800 flex flex-col justify-center">
                                        <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Track 2: Audio</span>
                                        <span className="text-[8px] text-blue-400 font-bold">Music & Voice</span>
                                    </div>
                                    <div className="flex-1 min-h-[160px] bg-gray-950/40 rounded-2xl border border-gray-800/50 p-4 space-y-3 relative overflow-x-auto custom-scrollbar">
                                        {audioFiles.map((a, idx) => (
                                            <div key={a.id} className="relative group/audio">
                                                <div 
                                                    className="h-12 bg-blue-500/20 border border-blue-500/30 rounded-xl relative overflow-hidden flex items-center px-4"
                                                    style={{ 
                                                        marginLeft: `${a.startTime * 20}px`, 
                                                        width: `${a.duration * 20}px` 
                                                    }}
                                                >
                                                    <div className="absolute inset-y-0 left-0 bg-blue-500/20" style={{ width: `${a.fadeIn * 20}px` }} title="Fade In Area"/>
                                                    <div className="absolute inset-y-0 right-0 bg-red-500/20" style={{ width: `${a.fadeOut * 20}px` }} title="Fade Out Area"/>
                                                    <MusicIcon className="w-4 h-4 text-blue-400 mr-3 shrink-0"/>
                                                    <span className="text-[10px] font-black text-white truncate shrink-0 max-w-[150px]">{a.name}</span>
                                                    <span className="text-[8px] font-bold text-blue-500/60 ml-auto whitespace-nowrap">{formatDuration(a.duration)}</span>
                                                </div>

                                                <div className="flex gap-4 mt-2 mb-4 bg-gray-900/40 p-3 rounded-xl border border-gray-800/30">
                                                    <div className="space-y-1 flex-1">
                                                        <label className="text-[7px] text-gray-500 font-black uppercase tracking-widest">Start Time Offset ({a.startTime}s)</label>
                                                        <input 
                                                            type="range" min="0" max={totalSlideshowDuration} step="1" 
                                                            value={a.startTime} 
                                                            onChange={e => {
                                                                const updated = [...audioFiles];
                                                                updated[idx].startTime = parseInt(e.target.value);
                                                                setAudioFiles(updated);
                                                            }}
                                                            className="w-full h-1 accent-blue-500" 
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[7px] text-gray-500 font-black uppercase tracking-widest">Fade In ({a.fadeIn}s)</label>
                                                        <input 
                                                            type="number" min="0" max="10" 
                                                            value={a.fadeIn} 
                                                            onChange={e => {
                                                                const updated = [...audioFiles];
                                                                updated[idx].fadeIn = parseFloat(e.target.value);
                                                                setAudioFiles(updated);
                                                            }}
                                                            className="w-12 bg-gray-950 text-white text-[9px] font-bold p-1 rounded border border-gray-800"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[7px] text-gray-500 font-black uppercase tracking-widest">Fade Out ({a.fadeOut}s)</label>
                                                        <input 
                                                            type="number" min="0" max="10" 
                                                            value={a.fadeOut} 
                                                            onChange={e => {
                                                                const updated = [...audioFiles];
                                                                updated[idx].fadeOut = parseFloat(e.target.value);
                                                                setAudioFiles(updated);
                                                            }}
                                                            className="w-12 bg-gray-950 text-white text-[9px] font-bold p-1 rounded border border-gray-800"
                                                        />
                                                    </div>
                                                    <button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))} className="self-end pb-1"><TrashIcon className="w-4 h-4 text-red-500 hover:scale-110 transition-transform"/></button>
                                                </div>
                                            </div>
                                        ))}
                                        {audioFiles.length === 0 && <div className="h-full flex items-center justify-center text-[10px] font-black uppercase text-gray-700 tracking-[0.3em]">Drop Music Tracks Above</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <footer className="shrink-0 bg-gray-950 p-6 rounded-t-[2.5rem] border-t border-gray-800 flex justify-between items-center shadow-inner">
                        <div className="flex items-center gap-6">
                            <div className="flex flex-col">
                                <span className="text-[10px] text-gray-500 font-black uppercase tracking-widest">Total Master Length</span>
                                <span className="text-2xl font-black text-brand-purple tracking-tighter">{formatDuration(totalSlideshowDuration)}</span>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <button onClick={startPlayback} className="bg-brand-purple text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-purple-700 shadow-xl transition-all active:scale-95 flex items-center gap-2"><PlayIcon className="w-5 h-5"/> Studio Preview</button>
                            <button onClick={handleSave} className="bg-white text-black px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-200 shadow-xl transition-all active:scale-95">Commit Changes</button>
                        </div>
                    </footer>
                </div>
            )}

            {isPlaying && (
                <div className="fixed inset-0 bg-black z-[100] flex items-center justify-center animate-fade-in">
                    <button onClick={() => setIsPlaying(false)} className="absolute top-10 right-10 text-white bg-black/40 hover:bg-red-600/90 p-4 rounded-full z-[110] backdrop-blur-xl transition-all border border-white/10 shadow-2xl"><XIcon className="w-10 h-10"/></button>
                    {mediaWithTimestamps[currentSlide] && (
                        <div className="w-full h-full relative flex items-center justify-center overflow-hidden">
                            <div key={mediaWithTimestamps[currentSlide].id} className={`w-full h-full absolute flex items-center justify-center transition-all duration-[1500ms] animate-${settings.slideStyle}`}>
                                {mediaWithTimestamps[currentSlide].type === 'image' ? (
                                    <img src={mediaWithTimestamps[currentSlide].previewUrl} className="w-full h-full object-contain" alt="slide" />
                                ) : (
                                    <video 
                                        ref={videoPreviewRef} 
                                        src={mediaWithTimestamps[currentSlide].previewUrl} 
                                        className="w-full h-full object-contain shadow-2xl" 
                                        autoPlay 
                                        muted={false} 
                                        onLoadedMetadata={e => {
                                            const video = e.target as HTMLVideoElement;
                                            video.volume = (mediaWithTimestamps[currentSlide] as VideoFile).volume || 1.0;
                                            const offset = elapsedTime - mediaWithTimestamps[currentSlide].timelineStart;
                                            if (offset > 0) video.currentTime = offset;
                                        }}
                                    />
                                )}
                            </div>
                            
                            {(settings.showCaptions && ((mediaWithTimestamps[currentSlide] as any).caption || (mediaWithTimestamps[currentSlide] as any).aiCaption)) && (
                                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/30 backdrop-blur-lg px-10 py-4 rounded-xl border border-white/5 text-center w-[92%] max-w-6xl animate-fade-in shadow-2xl z-50">
                                    <p className="text-white text-lg md:text-xl font-semibold tracking-wide leading-relaxed drop-shadow-md italic">
                                        {(mediaWithTimestamps[currentSlide] as any).caption || (mediaWithTimestamps[currentSlide] as any).aiCaption}
                                    </p>
                                </div>
                            )}

                            <div className="absolute bottom-4 left-4 right-4 h-1 bg-white/10 rounded-full overflow-hidden">
                                <div className="h-full bg-brand-purple transition-all" style={{ width: `${(elapsedTime / totalSlideshowDuration) * 100}%` }}/>
                            </div>
                        </div>
                    )}
                    
                    {audioFiles.map((a) => {
                        const isActive = elapsedTime >= a.startTime && elapsedTime < (a.startTime + a.duration);
                        const currentInClipTime = elapsedTime - a.startTime;
                        
                        let vol = 1.0;
                        if (isActive) {
                            if (currentInClipTime < a.fadeIn) {
                                vol = currentInClipTime / a.fadeIn;
                            } else if (currentInClipTime > (a.duration - a.fadeOut)) {
                                vol = (a.duration - currentInClipTime) / a.fadeOut;
                            }
                            
                            const duckFactor = getDuckingFactor(elapsedTime);
                            vol *= duckFactor;
                        }

                        return (
                            <AudioPlayer 
                                key={a.id} 
                                src={a.serverData?.url || (a.file ? URL.createObjectURL(a.file) : '')} 
                                active={isActive} 
                                volume={vol} 
                                startTimeInFile={currentInClipTime}
                            />
                        );
                    })}
                </div>
            )}
            
            <style>{`
                .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(109, 40, 217, 0.4); border-radius: 20px; }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                .animate-fade-in { animation: fadeIn 0.8s ease-out forwards; }
                input[type='range'] { -webkit-appearance: none; appearance: none; background: transparent; cursor: pointer; }
                input[type='range']::-webkit-slider-runnable-track { background: #374151; height: 0.25rem; border-radius: 0.5rem; }
                input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; margin-top: -6px; background-color: #6d28d9; height: 1rem; width: 1rem; border-radius: 9999px; }
            `}</style>
        </div>
    );
};

const AudioPlayer: React.FC<{ src: string, active: boolean, volume: number, startTimeInFile: number }> = ({ src, active, volume, startTimeInFile }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [hasStarted, setHasStarted] = useState(false);

    useEffect(() => {
        if (!audioRef.current) return;
        if (active) {
            if (!hasStarted) {
                audioRef.current.currentTime = Math.max(0, startTimeInFile);
                audioRef.current.play().catch(e => console.error("Audio block", e));
                setHasStarted(true);
            }
            audioRef.current.volume = Math.max(0, Math.min(1, volume));
        } else {
            audioRef.current.pause();
            setHasStarted(false);
        }
    }, [active, hasStarted, volume, startTimeInFile]);

    return <audio ref={audioRef} src={src} preload="auto" />;
};

export default App;