import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import {
    getFirestore,
    collection,
    doc,
    setDoc,
    serverTimestamp,
    Timestamp,
    query,
    where,
    onSnapshot,
    deleteDoc,
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
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = getFirestore(app as any);
const storage = getStorage(app as any);

// --- TYPE DEFINITIONS ---
interface ImageFile {
  id: string;
  type: 'image';
  file?: File;
  previewUrl: string;
  caption: string;
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
    rotation?: number;
    duration?: number;
}

interface SerializedAudioFile {
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
    name: string;
    media: SerializedMediaFile[];
    audio: SerializedAudioFile[];
    settings: SlideshowSettings;
    timestamp?: Timestamp; 
    createdAt?: Timestamp; 
    totalDuration?: number;
    sharedWith?: string[];
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

const getMillis = (val: any) => {
    if (val && typeof val.toMillis === 'function') return val.toMillis();
    if (val instanceof Date) return val.getTime();
    return 0;
};

// --- ICON COMPONENTS ---
const UploadIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>;
const MusicIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-13c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>;
const PlayIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const XIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
const PlusIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>;
const TrashIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>;
const AdjustmentIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>;
const SettingsIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
    const [user, setUser] = useState<firebase.User | null>(null);
    const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
    const [audioFiles, setAudioFiles] = useState<AppStateAudio[]>([]);
    const [settings, setSettings] = useState<SlideshowSettings>({
        interval: 5, slideStyle: 'ken-burns', showClock: true, smartCaptionsEnabled: false, repeatSlideshow: false, showCaptions: true,
    });
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [currentAudioIndex, setCurrentAudioIndex] = useState(0); 
    const [slideshowName, setSlideshowName] = useState('');
    const [currentSlideshowId, setCurrentSlideshowId] = useState<string | null>(null);
    const [ownedSlideshows, setOwnedSlideshows] = useState<SavedSlideshow[]>([]);
    const [sharedSlideshows, setSharedSlideshows] = useState<SavedSlideshow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isAdvancedEditorOpen, setIsAdvancedEditorOpen] = useState(false);

    const audioRef = useRef<HTMLAudioElement>(null);
    const videoPreviewRef = useRef<HTMLVideoElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);

    const totalSlideshowDuration = useMemo(() => {
        return mediaFiles.reduce((acc, curr) => acc + (curr.type === 'image' ? settings.interval : (curr.duration || 0)), 0);
    }, [mediaFiles, settings.interval]);

    const slideshowElapsedTime = useMemo(() => {
        return mediaFiles.slice(0, currentSlide).reduce((acc, curr) => acc + (curr.type === 'image' ? settings.interval : (curr.duration || 0)), 0);
    }, [currentSlide, mediaFiles, settings.interval]);

    const audioSrc = useMemo(() => {
        const currentAudio = audioFiles[currentAudioIndex];
        if (!currentAudio) return null;
        if (currentAudio.serverData) return currentAudio.serverData.url;
        if (currentAudio.file) return URL.createObjectURL(currentAudio.file);
        return null;
    }, [audioFiles, currentAudioIndex]);

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged((u) => { 
            setUser(u); 
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

        const qShared = query(collection(db, "slideshows"), where("sharedWith", "array-contains", user.email || ""));
        const unsubShared = onSnapshot(qShared, (snap) => {
            setSharedSlideshows(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedSlideshow)));
        });

        return () => { unsubOwned(); unsubShared(); };
    }, [user]);

    const allSlideshows = useMemo(() => {
        const combined = [...ownedSlideshows, ...sharedSlideshows];
        const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
        return unique.sort((a, b) => {
            const tA = getMillis(a.createdAt) || getMillis(a.timestamp) || 0;
            const tB = getMillis(b.createdAt) || getMillis(b.timestamp) || 0;
            return tB - tA;
        });
    }, [ownedSlideshows, sharedSlideshows]);

    const handleLogin = async () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        try { await auth.signInWithPopup(provider); } catch (e) { setError("Login failed"); }
    };

    const resetWorkspace = () => {
        setMediaFiles([]);
        setAudioFiles([]);
        setSlideshowName('');
        setCurrentSlideshowId(null);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const files = Array.from(e.target.files).slice(0, 20 - mediaFiles.length);
        const resolved = await Promise.all(files.map(async (f: File) => {
            const isImg = f.type.startsWith('image/');
            const dur = isImg ? 0 : await getMediaDuration(f);
            return {
                id: `m-${Math.random().toString(36).substr(2, 9)}`,
                file: f, previewUrl: URL.createObjectURL(f), type: isImg ? 'image' : 'video',
                rotation: 0, caption: '', duration: dur
            } as MediaFile;
        }));
        setMediaFiles(p => [...p, ...resolved]);
    };

    const handleAudioChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0]) return;
        const file = e.target.files[0];
        const duration = await getMediaDuration(file);
        setAudioFiles(p => [...p, { id: `a-${Date.now()}`, file, name: file.name, duration, startTime: 0, fadeIn: 1, fadeOut: 1 }]);
    };

    const handleSave = async () => {
        if (!user || !mediaFiles.length) return;
        setIsSaving(true);
        try {
            const id = currentSlideshowId || doc(collection(db, 'slideshows')).id;
            const serMedia = await Promise.all(mediaFiles.map(async m => {
                const b: any = { id: m.id, type: m.type, name: m.id, rotation: m.rotation, caption: (m as any).caption, duration: (m as any).duration };
                if (!m.serverData && m.file) {
                    const path = `users/${user.uid}/${id}/${m.id}`;
                    await uploadBytes(ref(storage, path), m.file);
                    b.url = await getDownloadURL(ref(storage, path));
                    b.storagePath = path;
                } else {
                    b.url = m.serverData?.url; b.storagePath = m.serverData?.storagePath;
                }
                return b;
            }));
            const serAudio = await Promise.all(audioFiles.map(async a => {
                const b: any = { name: a.name, duration: a.duration, startTime: a.startTime, fadeIn: a.fadeIn, fadeOut: a.fadeOut };
                if (!a.serverData && a.file) {
                    const path = `users/${user.uid}/${id}/a-${a.id}`;
                    await uploadBytes(ref(storage, path), a.file);
                    b.url = await getDownloadURL(ref(storage, path));
                    b.storagePath = path;
                } else {
                    b.url = a.serverData?.url; b.storagePath = a.serverData?.storagePath;
                }
                return b;
            }));
            
            const existing = ownedSlideshows.find(s => s.id === id);
            await setDoc(doc(db, 'slideshows', id), {
                userId: user.uid, name: slideshowName || 'Untitled', media: serMedia, audio: serAudio,
                settings, totalDuration: totalSlideshowDuration, timestamp: serverTimestamp(), createdAt: existing?.createdAt || serverTimestamp()
            }, { merge: true });
            setCurrentSlideshowId(id);
        } catch (e) { setError("Save failed"); } finally { setIsSaving(false); }
    };

    const handleLoad = (s: SavedSlideshow) => {
        setMediaFiles(s.media.map(m => ({ id: m.id, type: m.type as any, previewUrl: m.url, rotation: m.rotation || 0, caption: m.caption || '', duration: m.duration || 0, serverData: { url: m.url, storagePath: m.storagePath } })));
        setAudioFiles(s.audio.map((a, i) => ({ id: `l-${i}`, name: a.name, duration: a.duration || 0, startTime: a.startTime || 0, fadeIn: a.fadeIn || 1, fadeOut: a.fadeOut || 1, serverData: { url: a.url, storagePath: a.storagePath } })));
        setSettings(s.settings); setSlideshowName(s.name); setCurrentSlideshowId(s.id);
    };

    const handleDelete = async (s: SavedSlideshow) => {
        if (!user || s.userId !== user.uid) return;
        if (!window.confirm(`Delete "${s.name}"?`)) return;
        setIsProcessing(true);
        try {
            await deleteDoc(doc(db, 'slideshows', s.id));
            if (currentSlideshowId === s.id) resetWorkspace();
        } catch (e) { setError("Delete failed"); } finally { setIsProcessing(false); }
    };

    if (isLoading) return (
        <div className="min-h-screen bg-brand-dark flex items-center justify-center">
            <div className="w-12 h-12 border-4 border-brand-purple border-t-transparent rounded-full animate-spin"></div>
        </div>
    );

    return (
        <div className={`min-h-screen font-sans ${user ? 'bg-brand-dark text-gray-200' : 'bg-white text-gray-900'}`}>
            {(isSaving || isProcessing) && (
                <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center">
                    <div className="text-center">
                        <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-brand-purple mx-auto"></div>
                        <p className="text-white text-xl mt-4">Syncing...</p>
                    </div>
                </div>
            )}

            <header className={`p-4 flex justify-between items-center border-b sticky top-0 z-40 backdrop-blur-md ${user ? 'bg-gray-900/50 border-gray-800' : 'bg-white/90 border-gray-100'}`}>
                <h1 className="text-2xl font-bold tracking-tight"><span className="text-brand-purple">Muziq</span> Slides</h1>
                <div className="flex gap-4">
                    {user ? <button onClick={() => auth.signOut()} className="bg-gray-200 text-gray-900 py-2 px-4 rounded-lg text-sm font-bold shadow-sm">Logout</button> : <button onClick={handleLogin} className="bg-brand-purple text-white py-2 px-4 rounded-lg text-sm font-bold shadow-md">Sign In</button>}
                </div>
            </header>

            {!user ? (
                <main className="animate-fade-in text-center py-20 px-4">
                    <h2 className="text-5xl font-extrabold mb-6 leading-tight">Turn Memories into <br/><span className="text-brand-purple">Masterpieces</span></h2>
                    <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto">Create beautiful photo slideshows with your favorite music. Perfect for Roku or Amazon Fire TV screensavers.</p>
                    <button onClick={handleLogin} className="bg-brand-purple text-white py-4 px-12 rounded-full text-lg font-bold shadow-xl hover:scale-105 transition-transform">Get Started for Free</button>
                    
                    <div className="mt-20 grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                        <div className="p-8 bg-gray-50 rounded-3xl border border-gray-100 shadow-sm"><UploadIcon className="w-10 h-10 mx-auto mb-4 text-brand-purple"/><h4 className="font-bold mb-2">Upload Media</h4><p className="text-sm text-gray-500">Up to 20 photos and videos in one sequence.</p></div>
                        <div className="p-8 bg-gray-50 rounded-3xl border border-gray-100 shadow-sm"><MusicIcon className="w-10 h-10 mx-auto mb-4 text-brand-purple"/><h4 className="font-bold mb-2">Add Background Music</h4><p className="text-sm text-gray-500">Professional timeline for exact audio timing.</p></div>
                        <div className="p-8 bg-gray-50 rounded-3xl border border-gray-100 shadow-sm"><AdjustmentIcon className="w-10 h-10 mx-auto mb-4 text-brand-purple"/><h4 className="font-bold mb-2">Smart Audio</h4><p className="text-sm text-gray-500">Auto-ducking background music for video clips.</p></div>
                    </div>
                </main>
            ) : (
                <main className="p-4 sm:p-8 grid lg:grid-cols-2 gap-8 max-w-7xl mx-auto">
                    <div className="space-y-6">
                        <section className="bg-gray-800/40 p-6 rounded-3xl border border-gray-700/50 shadow-xl">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-white"><UploadIcon className="w-5 h-5 text-brand-purple"/> 1. Upload Media</h3>
                            <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-gray-700 rounded-2xl p-8 text-center cursor-pointer hover:border-brand-purple hover:bg-brand-purple/5 transition-all">
                                <UploadIcon className="w-10 h-10 mx-auto text-gray-500 mb-2"/>
                                <p className="text-sm text-gray-400">Click to upload photos or videos</p>
                            </div>
                            <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept="image/*,video/*" className="hidden" />
                            <div className="mt-4 grid grid-cols-4 gap-3">
                                {mediaFiles.map(m => (
                                    <div key={m.id} className="aspect-square bg-black rounded-xl overflow-hidden relative group border border-gray-700">
                                        <img src={m.previewUrl} className="w-full h-full object-cover" />
                                        <button onClick={() => setMediaFiles(p => p.filter(x => x.id !== m.id))} className="absolute top-1 right-1 bg-red-600/80 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"><XIcon className="w-3 h-3 text-white"/></button>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="bg-gray-800/40 p-6 rounded-3xl border border-gray-700/50 shadow-xl">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-white"><MusicIcon className="w-5 h-5 text-brand-purple"/> 2. Add Background Music</h3>
                            <button onClick={() => audioInputRef.current?.click()} className="w-full bg-gray-700/50 hover:bg-gray-700 py-3 rounded-xl font-bold flex justify-center gap-2 border border-gray-600/50 transition-colors"><PlusIcon className="w-5 h-5"/> Add Track</button>
                            <input type="file" ref={audioInputRef} onChange={handleAudioChange} accept="audio/*" className="hidden" />
                            <div className="mt-4 space-y-2">
                                {audioFiles.map(a => <div key={a.id} className="bg-gray-700/30 p-4 rounded-2xl flex justify-between items-center text-sm font-medium border border-gray-700/50"><span>{a.name} <span className="text-gray-500 font-normal ml-2">{formatDuration(a.duration)}</span></span><button onClick={() => setAudioFiles(p => p.filter(x => x.id !== a.id))}><TrashIcon className="w-4 h-4 text-red-400 hover:scale-110 transition-transform"/></button></div>)}
                            </div>
                        </section>

                        <section className="bg-gray-800/40 p-6 rounded-3xl border border-gray-700/50 shadow-xl">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-white"><SettingsIcon className="w-5 h-5 text-brand-purple"/> 3. Settings</h3>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <label className="text-sm text-gray-400">Photo Interval</label>
                                    <span className="text-brand-purple font-bold">{settings.interval}s</span>
                                </div>
                                <input type="range" min="1" max="30" value={settings.interval} onChange={e => setSettings(s => ({...s, interval: +e.target.value}))} className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-purple" />
                            </div>
                        </section>
                    </div>

                    <div className="space-y-6">
                        <section className="bg-gray-800/40 p-6 rounded-3xl border border-gray-700/50 shadow-xl">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-bold flex items-center gap-2 text-white"><PlayIcon className="w-5 h-5 text-brand-purple"/> 4. Run Slideshow</h3>
                                <button onClick={() => setIsAdvancedEditorOpen(true)} className="text-[10px] bg-brand-purple/20 text-brand-purple border border-brand-purple/30 py-1.5 px-4 rounded-full flex items-center gap-1.5 hover:bg-brand-purple/40 font-bold tracking-wide uppercase transition-all shadow-sm"><AdjustmentIcon className="w-3 h-3"/> Advanced Editor</button>
                            </div>
                            <div className="aspect-video bg-black rounded-2xl relative flex items-center justify-center overflow-hidden group border border-gray-700/50">
                                {mediaFiles.length > 0 ? (
                                    <>
                                        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                                            {mediaFiles[0].type === 'image' ? <img src={mediaFiles[0].previewUrl} className="w-full h-full object-cover blur-sm opacity-50" /> : null}
                                        </div>
                                        <button onClick={() => setIsPlaying(true)} className="relative z-10 flex items-center justify-center bg-brand-purple p-6 rounded-full shadow-2xl scale-100 hover:scale-110 active:scale-95 transition-all"><PlayIcon className="w-12 h-12 text-white"/></button>
                                    </>
                                ) : <p className="text-gray-500 italic">No media added yet</p>}
                            </div>
                        </section>

                        <section className="bg-gray-800/40 p-6 rounded-3xl border border-gray-700/50 shadow-xl">
                            <h3 className="text-lg font-bold mb-4 text-white">5. Save & Manage</h3>
                            <div className="flex gap-2 mb-6">
                                <input value={slideshowName} onChange={e => setSlideshowName(e.target.value)} placeholder="Slideshow Name" className="flex-1 bg-gray-700/50 rounded-xl px-4 py-2 border border-gray-600/50 outline-none focus:ring-1 focus:ring-brand-purple placeholder:text-gray-500" />
                                <button onClick={handleSave} disabled={isSaving} className="bg-brand-purple hover:bg-purple-700 py-2 px-8 rounded-xl font-bold disabled:opacity-50 shadow-lg shadow-brand-purple/20 transition-all">Save</button>
                            </div>
                            <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                                {allSlideshows.length > 0 ? allSlideshows.map(s => (
                                    <div key={s.id} className="bg-gray-700/20 p-4 rounded-2xl flex justify-between items-center group border border-gray-700/30 hover:border-gray-600/50 transition-colors">
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-bold text-sm text-white truncate">{s.name}</h4>
                                            <p className="text-[10px] text-gray-500 mt-0.5">Duration: {formatDuration(s.totalDuration || 0)}</p>
                                        </div>
                                        <div className="flex gap-2 ml-4">
                                            <button onClick={() => handleLoad(s)} className="text-[10px] bg-brand-purple/10 text-brand-purple border border-brand-purple/20 py-1.5 px-4 rounded-lg font-bold hover:bg-brand-purple/20 transition-all">Load</button>
                                            {s.userId === user?.uid && (
                                                <button onClick={() => handleDelete(s)} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all"><TrashIcon className="w-4 h-4"/></button>
                                            )}
                                        </div>
                                    </div>
                                )) : <div className="text-center py-8 text-gray-600 text-sm italic">You haven't saved any slideshows yet</div>}
                            </div>
                        </section>
                    </div>
                </main>
            )}

            {isAdvancedEditorOpen && (
                <div className="fixed inset-0 bg-black/95 z-[90] flex items-center justify-center p-4 animate-fade-in backdrop-blur-sm">
                    <div className="bg-gray-900 w-full max-w-5xl rounded-[2.5rem] border border-gray-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-8 border-b border-gray-800 flex justify-between items-center bg-gray-800/20">
                            <h2 className="text-2xl font-bold flex items-center gap-3"><AdjustmentIcon className="w-8 h-8 text-brand-purple"/> Timeline Editor</h2>
                            <button onClick={() => setIsAdvancedEditorOpen(false)} className="hover:rotate-90 transition-transform"><XIcon className="w-8 h-8 text-gray-500"/></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-8 space-y-10">
                            <div className="space-y-6">
                                <div className="flex items-center gap-6">
                                    <div className="w-24 text-[10px] text-gray-500 font-extrabold uppercase tracking-widest">Media Track</div>
                                    <div className="flex-1 h-24 bg-gray-800/50 rounded-2xl flex items-center gap-2 p-3 overflow-x-auto border border-gray-700/50">
                                        {mediaFiles.map(m => (
                                            <div key={m.id} className="h-full aspect-square bg-black rounded-xl border border-brand-purple/20 overflow-hidden flex-shrink-0">
                                                <img src={m.previewUrl} className="w-full h-full object-cover" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex items-start gap-6">
                                    <div className="w-24 text-[10px] text-gray-500 font-extrabold uppercase tracking-widest mt-4">Audio Track</div>
                                    <div className="flex-1 space-y-3">
                                        {audioFiles.map(a => (
                                            <div key={a.id} className="bg-brand-purple/5 border border-brand-purple/20 p-6 rounded-3xl flex flex-wrap gap-6 items-center shadow-inner">
                                                <span className="text-sm font-bold flex-1 text-white">{a.name}</span>
                                                <div className="flex gap-8">
                                                    <label className="flex flex-col gap-1 text-[10px] text-gray-500 uppercase tracking-tighter">Start Offset
                                                        <input type="number" value={a.startTime} onChange={e => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, startTime: +e.target.value} : x))} className="bg-gray-800 rounded-lg px-2 py-1.5 text-white outline-none w-16 border border-gray-700 focus:border-brand-purple transition-colors"/></label>
                                                    <label className="flex flex-col gap-1 text-[10px] text-gray-500 uppercase tracking-tighter">Fade In
                                                        <input type="number" value={a.fadeIn} onChange={e => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, fadeIn: +e.target.value} : x))} className="bg-gray-800 rounded-lg px-2 py-1.5 text-white outline-none w-16 border border-gray-700 focus:border-brand-purple transition-colors"/></label>
                                                    <label className="flex flex-col gap-1 text-[10px] text-gray-500 uppercase tracking-tighter">Fade Out
                                                        <input type="number" value={a.fadeOut} onChange={e => setAudioFiles(p => p.map(x => x.id === a.id ? {...x, fadeOut: +e.target.value} : x))} className="bg-gray-800 rounded-lg px-2 py-1.5 text-white outline-none w-16 border border-gray-700 focus:border-brand-purple transition-colors"/></label>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="p-8 bg-gray-800/30 flex justify-end"><button onClick={() => setIsAdvancedEditorOpen(false)} className="bg-brand-purple hover:bg-purple-700 py-4 px-12 rounded-2xl font-bold shadow-xl shadow-brand-purple/20 transition-all">Apply Changes</button></div>
                    </div>
                </div>
            )}

            {isPlaying && (
                <div className="fixed inset-0 bg-black z-[100] flex items-center justify-center animate-fade-in">
                    <button onClick={() => setIsPlaying(false)} className="absolute top-8 right-8 text-white bg-black/40 hover:bg-red-600/80 p-3 rounded-full z-[110] backdrop-blur-md transition-colors"><XIcon className="w-10 h-10"/></button>
                    {mediaFiles[currentSlide] && (
                        <div className="w-full h-full relative flex items-center justify-center overflow-hidden">
                            <div className={`w-full h-full absolute transition-opacity duration-1000 animate-${settings.slideStyle}`}>
                                {mediaFiles[currentSlide].type === 'image' ? (
                                    <img src={mediaFiles[currentSlide].previewUrl} className="w-full h-full object-cover" />
                                ) : (
                                    <video ref={videoPreviewRef} src={mediaFiles[currentSlide].previewUrl} className="w-full h-full object-contain" autoPlay muted={false} onEnded={() => currentSlide < mediaFiles.length - 1 ? setCurrentSlide(s => s + 1) : setIsPlaying(false)} />
                                )}
                            </div>
                        </div>
                    )}
                    {audioSrc && (
                        <audio 
                            ref={audioRef} 
                            src={audioSrc} 
                            autoPlay 
                            onEnded={() => {
                                if (currentAudioIndex < audioFiles.length - 1) setCurrentAudioIndex(i => i + 1);
                                else if (settings.repeatSlideshow) setCurrentAudioIndex(0);
                            }} 
                        />
                    )}
                </div>
            )}
        </div>
    );
};

export default App;