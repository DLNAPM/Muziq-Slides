

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
// Fix: Changed firebase imports to use scoped packages (firebase/...)
// to resolve "no exported member" errors, which typically occur when
// using the modular v9 SDK with an environment that expects scoped packages.
import { initializeApp } from 'firebase/app';
import {
    getAuth,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    type User,
    setPersistence,
    browserLocalPersistence
} from 'firebase/auth';
import {
    getFirestore,
    collection,
    doc,
    setDoc,
    serverTimestamp,
    Timestamp,
    query,
    where,
    orderBy,
    onSnapshot,
    deleteDoc,
} from '@irebase/firestore';
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
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


// --- FIREBASE INITIALIZATION (v9+ Syntax) ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);


// --- TYPE DEFINITIONS ---
interface ImageFile {
  id: string;
  type: 'image';
  file: File;
  previewUrl: string;
  caption?: string;
}

interface VideoFile {
    id:string;
    type: 'video';
    file: File;
    previewUrl: string;
}

type MediaFile = ImageFile | VideoFile;

interface SlideshowSettings {
    interval: number;
    slideStyle: string;
    showClock: boolean;
    smartCaptionsEnabled: boolean;
}

interface SerializedMediaFile {
    id: string;
    type: 'image' | 'video';
    name: string;
    url: string; 
    storagePath: string;
    caption?: string;
}

interface SerializedAudioFile {
    name: string;
    url: string;
    storagePath: string;
}

interface SavedSlideshow {
    id: string; 
    userId: string;
    name: string;
    media: SerializedMediaFile[];
    audio: SerializedAudioFile | null;
    settings: SlideshowSettings;
    timestamp?: Timestamp;
}

// --- HELPER FUNCTIONS ---
const fileToGenerativePart = async (file: File) => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
    });
    return {
        inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
    };
};

const urlToFile = async (url: string, filename: string): Promise<File> => {
    const response = await fetch(url);
    const blob = await response.blob();
    return new File([blob], filename, { type: blob.type });
};


// --- ICON COMPONENTS ---
const UploadIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);
const MusicIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-13c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
  </svg>
);
const PlayIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
);
const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);
const InfoIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);
const FilmIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
    </svg>
);
const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
);
const SaveIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
    </svg>
);
const GoogleIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
        <path fill="none" d="M0 0h48v48H0z"></path>
    </svg>
);

// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
    const [user, setUser] = useState<User | null>(null);
    const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
    const [audioFile, setAudioFile] = useState<{ file: File, name: string } | null>(null);
    const [settings, setSettings] = useState<SlideshowSettings>({
        interval: 5,
        slideStyle: 'ken-burns',
        showClock: true,
        smartCaptionsEnabled: false,
    });
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [slideshowName, setSlideshowName] = useState('');
    const [savedSlideshows, setSavedSlideshows] = useState<SavedSlideshow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const audioRef = useRef<HTMLAudioElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);

    // --- AUTHENTICATION ---
    useEffect(() => {
        setIsLoading(true);
        // Fix: Explicitly set auth persistence to local. This ensures the user
        // remains logged in after closing and reopening the browser.
        setPersistence(auth, browserLocalPersistence)
            .then(() => {
                const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
                    setUser(currentUser);
                    setIsLoading(false);
                });
                return unsubscribe;
            })
            .catch((err) => {
                console.error("Error setting persistence:", err);
                setError("Could not save your login session. Please try again.");
                setIsLoading(false);
            });
    }, []);

    const handleLogin = async () => {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Authentication error:", error);
            setError("Failed to sign in with Google. Please try again.");
        }
    };

    const handleLogout = async () => {
        try {
            await signOut(auth);
            // Reset state on logout
            setMediaFiles([]);
            setAudioFile(null);
            setSlideshowName('');
            setSavedSlideshows([]);
        } catch (error) {
            console.error("Sign out error:", error);
            setError("Failed to sign out. Please try again.");
        }
    };
    
    // --- UI LOGIC ---
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files).slice(0, 20 - mediaFiles.length);
            const newMediaFiles: MediaFile[] = files.map(file => {
                const newFile: MediaFile = {
                    id: `${file.name}-${Date.now()}`,
                    file,
                    previewUrl: URL.createObjectURL(file),
                    type: file.type.startsWith('image/') ? 'image' : 'video'
                };
                if (newFile.type === 'image') (newFile as ImageFile).caption = '';
                return newFile;
            });
            setMediaFiles(prev => [...prev, ...newMediaFiles]);
        }
    };

    const handleAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setAudioFile({ file: e.target.files[0], name: e.target.files[0].name });
        }
    };

    const handleDeleteMedia = (id: string) => {
        setMediaFiles(prev => prev.filter(media => media.id !== id));
    };

    const handlePlay = () => {
        if (mediaFiles.length === 0) {
            setError("Please upload at least one image or video to start the slideshow.");
            return;
        }
        setError(null);
        setCurrentSlide(0);
        setIsPlaying(true);
        if (audioRef.current && audioFile) {
            audioRef.current.currentTime = 0;
            audioRef.current.play();
        }
    };

    // Slideshow playback logic
    useEffect(() => {
        let timer: NodeJS.Timeout;
        if (isPlaying && mediaFiles.length > 0) {
            timer = setTimeout(() => {
                setCurrentSlide(prev => (prev + 1) % mediaFiles.length);
            }, settings.interval * 1000);
        }
        return () => clearTimeout(timer);
    }, [isPlaying, currentSlide, mediaFiles.length, settings.interval]);

    const handleClosePreview = () => {
        setIsPlaying(false);
        if (audioRef.current) {
            audioRef.current.pause();
        }
    };

    const currentMedia = useMemo(() => mediaFiles[currentSlide], [mediaFiles, currentSlide]);

    return (
        <div className="min-h-screen bg-brand-dark text-gray-200 font-sans">
            <header className="bg-gray-900/50 backdrop-blur-sm shadow-lg p-4 flex justify-between items-center sticky top-0 z-50">
                <h1 className="text-3xl font-bold text-white tracking-wider">
                    <span className="text-brand-purple">Muziq</span> Slides
                </h1>
                <div>
                    {isLoading ? (
                        <div className="text-gray-400">Loading...</div>
                    ) : user ? (
                        <div className="flex items-center gap-4">
                            <img src={user.photoURL ?? ''} alt={user.displayName ?? 'User'} className="w-10 h-10 rounded-full" />
                            <span className="hidden sm:block">{user.displayName}</span>
                            <button onClick={handleLogout} className="bg-brand-purple hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                                Logout
                            </button>
                        </div>
                    ) : (
                        <button onClick={handleLogin} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg flex items-center gap-2 transition-colors">
                            <GoogleIcon className="w-5 h-5" />
                            Sign in with Google
                        </button>
                    )}
                </div>
            </header>

            <main className="p-8">
                 {!user ? (
                    <div className="text-center py-20 bg-gray-800/50 rounded-lg">
                        <h2 className="text-4xl font-bold mb-4">Welcome to Muziq Slides</h2>
                        <p className="text-xl text-gray-400 mb-8">Sign in to create, save, and load your beautiful photo slideshows.</p>
                        <button onClick={handleLogin} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg flex items-center gap-2 transition-colors mx-auto text-lg">
                            <GoogleIcon className="w-6 h-6" />
                            Sign in with Google to Get Started
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Controls Column */}
                        <div className="lg:col-span-1 space-y-6">
                           {/* Uploader */}
                            <div className="bg-gray-800/50 p-6 rounded-lg">
                                <h3 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">1. Upload Media</h3>
                                <div 
                                    onClick={() => fileInputRef.current?.click()}
                                    className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-brand-purple hover:bg-gray-800 transition-colors"
                                >
                                    <UploadIcon className="w-12 h-12 mx-auto text-gray-500" />
                                    <p className="mt-2 text-gray-400">Click to upload images/videos</p>
                                    <p className="text-xs text-gray-500">Max 20 files</p>
                                </div>
                                <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept="image/*,video/*" className="hidden" />
                                <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-2">
                                    {mediaFiles.map(media => (
                                        <div key={media.id} className="relative group">
                                            <img src={media.previewUrl} alt={media.file.name} className="w-full h-24 object-cover rounded-md" />
                                            <button onClick={() => handleDeleteMedia(media.id)} className="absolute top-1 right-1 bg-black/50 rounded-full p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                                                <XIcon className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            
                            {/* Music Picker */}
                            <div className="bg-gray-800/50 p-6 rounded-lg">
                                <h3 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">2. Add Music</h3>
                                 <div 
                                    onClick={() => audioInputRef.current?.click()}
                                    className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-brand-purple hover:bg-gray-800 transition-colors"
                                >
                                    <MusicIcon className="w-12 h-12 mx-auto text-gray-500" />
                                    <p className="mt-2 text-gray-400">{audioFile ? audioFile.name : 'Click to select an audio file'}</p>
                                </div>
                                <input type="file" ref={audioInputRef} onChange={handleAudioChange} accept="audio/*" className="hidden" />
                                {audioFile && (
                                    <audio ref={audioRef} src={URL.createObjectURL(audioFile.file)} className="w-full mt-4" controls />
                                )}
                            </div>

                        </div>
                        
                        {/* Preview and Settings Column */}
                        <div className="lg:col-span-2 space-y-6">
                            <div className="bg-gray-800/50 p-6 rounded-lg">
                               <h3 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">3. Preview & Launch</h3>
                                <div className="aspect-video bg-black rounded-lg flex items-center justify-center relative overflow-hidden">
                                    {mediaFiles.length > 0 ? (
                                        <img src={mediaFiles[0].previewUrl} alt="Preview" className="w-full h-full object-contain" />
                                    ) : (
                                        <div className="text-gray-500">
                                            <FilmIcon className="w-24 h-24 mx-auto" />
                                            <p>Your slideshow will appear here</p>
                                        </div>
                                    )}
                                     <button onClick={handlePlay} className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed" disabled={mediaFiles.length === 0}>
                                        <PlayIcon className="w-20 h-20 text-white" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-red-500 text-white py-2 px-6 rounded-lg shadow-lg z-50 flex items-center gap-2">
                        <InfoIcon className="w-5 h-5" />
                        {error}
                        <button onClick={() => setError(null)} className="ml-4 font-bold">
                            <XIcon className="w-5 h-5"/>
                        </button>
                    </div>
                )}
            </main>

            {/* Fullscreen Preview Modal */}
            {isPlaying && (
                <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center animate-fade-in">
                    <button onClick={handleClosePreview} className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2 z-50">
                        <XIcon className="w-8 h-8" />
                    </button>
                    
                    {currentMedia && (
                        <div className="w-full h-full relative">
                            {currentMedia.type === 'image' && (
                                <img
                                    key={currentMedia.id}
                                    src={currentMedia.previewUrl}
                                    alt="Slideshow"
                                    className={`w-full h-full object-cover animate-${settings.slideStyle}`}
                                />
                            )}
                            {currentMedia.type === 'video' && (
                                <video
                                    key={currentMedia.id}
                                    src={currentMedia.previewUrl}
                                    className="w-full h-full object-contain"
                                    autoPlay
                                    muted
                                />
                            )}
                             <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />
                        </div>
                    )}

                    {settings.showClock && (
                        <div className="absolute top-5 left-5 text-white text-2xl font-semibold bg-black/30 p-2 rounded-lg">
                           {new Date().toLocaleTimeString()}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default App;
