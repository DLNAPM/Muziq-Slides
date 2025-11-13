

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
// Fix: Use modular imports for Firebase v9+ to resolve module resolution issues.
import { initializeApp } from 'firebase/app';
import {
    getAuth,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    type User
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
} from 'firebase/firestore';
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
// Fix: Use modular Firebase functions.
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
    // Fix: Use imported Timestamp type from firestore.
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
    <svg className={className} viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path><path fill="none" d="M0 0h48v48H0z"></path></svg>
);


// --- UI HELPER COMPONENTS ---
const Tooltip: React.FC<{ message: string; children: React.ReactNode }> = ({ message, children }) => (
    <div className="relative flex items-center group">
        {children}
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-xs px-3 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg shadow-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none border border-gray-600 z-10">
            {message}
        </div>
    </div>
);

const ToggleSwitch: React.FC<{ enabled: boolean; onChange: (enabled: boolean) => void; label: string; disabled?: boolean; }> = ({ enabled, onChange, label, disabled = false }) => (
    <div className={`flex items-center ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <label className={`mr-3 font-medium text-gray-300 ${!disabled && 'cursor-pointer'}`} onClick={() => !disabled && onChange(!enabled)}>{label}</label>
        <button
            onClick={() => !disabled && onChange(!enabled)}
            disabled={disabled}
            className={`${enabled ? 'bg-purple-600' : 'bg-gray-600'} relative inline-flex items-center h-6 rounded-full w-11 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-purple-500`}
            aria-checked={enabled}
        >
            <span
                className={`${enabled ? 'translate-x-6' : 'translate-x-1'} inline-block w-4 h-4 transform bg-white rounded-full transition-transform`}
            />
        </button>
    </div>
);


// --- LOGIN SCREEN COMPONENT ---
const LoginScreen: React.FC<{ onLogin: () => void, error: string | null }> = ({ onLogin, error }) => {
    return (
        <div className="min-h-screen bg-gray-900 text-gray-200 flex flex-col items-center justify-center p-4">
            <div className="text-center mb-10">
                <h1 className="text-5xl sm:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-600">
                    Muziq Slides
                </h1>
                <p className="mt-4 text-xl text-gray-400">Your personal photo and music screensaver in the cloud.</p>
            </div>
            <div className="bg-gray-800/50 p-8 rounded-lg border border-gray-700 shadow-lg text-center">
                <h2 className="text-2xl font-semibold mb-6">Sign In to Continue</h2>
                <button 
                    onClick={onLogin} 
                    className="w-full flex items-center justify-center gap-3 bg-white text-gray-700 font-semibold py-3 px-6 rounded-lg hover:bg-gray-200 transition-colors shadow-md"
                >
                    <GoogleIcon className="w-6 h-6" />
                    Sign in with Google
                </button>
                {error && <p className="text-red-400 mt-4">{error}</p>}
                <p className="text-xs text-gray-500 mt-6">By signing in, you agree to our imaginary Terms of Service.</p>
            </div>
        </div>
    );
};


// --- MAIN APPLICATION COMPONENT ---
export default function App() {
  // Fix: Use imported User type from firebase/auth.
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [media, setMedia] = useState<MediaFile[]>([]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [interval, setIntervalValue] = useState<number>(5);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [showPublishedModal, setShowPublishedModal] = useState<boolean>(false);
  const [showInfoModal, setShowInfoModal] = useState<boolean>(false);
  const [slideStyle, setSlideStyle] = useState<string>('kenburns');
  const [showClock, setShowClock] = useState<boolean>(true);
  const [smartCaptionsEnabled, setSmartCaptionsEnabled] = useState<boolean>(false);
  const [captionStatus, setCaptionStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle');
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [adjustmentNotification, setAdjustmentNotification] = useState<string | null>(null);
  const [isApiKeyAvailable, setIsApiKeyAvailable] = useState<boolean>(false);

  const [savedSlideshows, setSavedSlideshows] = useState<SavedSlideshow[]>([]);
  const [activeSlideshowId, setActiveSlideshowId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState(false);

  const mediaInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const isAutoAdjusting = useRef(false);
  
  const MAX_IMAGES = 30;
  const MAX_VIDEOS = 1;
  const MAX_VIDEO_DURATION = 30; // in seconds

  const activeSlideshowName = useMemo(() => {
    if (!activeSlideshowId) return "New Slideshow";
    return savedSlideshows.find(s => s.id === activeSlideshowId)?.name || "New Slideshow";
  }, [activeSlideshowId, savedSlideshows]);
  
  const { imageCount, videoCount } = useMemo(() => {
    return media.reduce((acc, item) => {
      if (item.type === 'image') acc.imageCount++;
      if (item.type === 'video') acc.videoCount++;
      return acc;
    }, { imageCount: 0, videoCount: 0 });
  }, [media]);

  // --- CALLBACKS ---
  const handleNewSlideshow = useCallback(() => {
    setMedia([]);
    setAudioFile(null);
    setIntervalValue(5);
    setSlideStyle('kenburns');
    setShowClock(true);
    setSmartCaptionsEnabled(false);
    setCaptionStatus('idle');
    setActiveSlideshowId(null);
  }, []);

  const generateCaptions = useCallback(async () => {
    if (!smartCaptionsEnabled || captionStatus === 'generating' || !isApiKeyAvailable) return;

    const imagesToCaption = media.filter((item): item is ImageFile => item.type === 'image' && !item.caption);
    if (imagesToCaption.length === 0) {
        if (media.length > 0) setCaptionStatus('done');
        return;
    }

    setCaptionStatus('generating');
    try {
      const apiKey = process.env.API_KEY;
      if (!apiKey) throw new Error("API Key not found");
      const ai = new GoogleGenAI({ apiKey });
      const updatedMedia = [...media];

      for (const imageFile of imagesToCaption) {
        const imagePart = await fileToGenerativePart(imageFile.file);
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [imagePart, { text: "Describe this image in a short, one-sentence caption for a photo slideshow." }] },
        });
        const caption = response.text;
        
        const index = updatedMedia.findIndex(item => item.id === imageFile.id);
        if (index !== -1 && updatedMedia[index].type === 'image') {
            (updatedMedia[index] as ImageFile).caption = caption.trim();
        }
      }
      setMedia(updatedMedia);
      setCaptionStatus('done');
    } catch (error) {
      console.error("Error generating captions:", error);
      setCaptionStatus('error');
    }
  }, [media, smartCaptionsEnabled, captionStatus, isApiKeyAvailable]);
  
  const handleSaveSlideshow = useCallback(async () => {
    if (!user) {
        alert("You must be signed in to save a slideshow.");
        return;
    }

    let slideshowName = activeSlideshowName;
    let slideshowId = activeSlideshowId;
    
    const isNewSlideshow = !slideshowId;

    if (isNewSlideshow) {
        slideshowName = window.prompt("Enter a name for your slideshow:", "My Slideshow");
        if (!slideshowName) return; // User cancelled
        // Fix: Use modular Firebase functions.
        const newDocRef = doc(collection(db, "slideshows"));
        slideshowId = newDocRef.id;
    }
    
    if (!slideshowId) return; // Should not happen, but a safeguard.

    setIsSaving(true);
    try {
        const uploadFile = async (file: File, path: string): Promise<{ url: string, storagePath: string }> => {
            // Fix: Use modular Firebase functions.
            const storageRef = ref(storage, path);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);
            return { url, storagePath: path };
        };

        const serializedMedia: SerializedMediaFile[] = await Promise.all(
            media.map(async (m) => {
                const path = `users/${user.uid}/slideshows/${slideshowId}/${m.file.name}`;
                const { url, storagePath } = await uploadFile(m.file, path);
                const serializedItem: SerializedMediaFile = {
                    id: m.id,
                    type: m.type,
                    name: m.file.name,
                    url,
                    storagePath,
                };
                if (m.type === 'image' && m.caption) {
                    serializedItem.caption = m.caption;
                }
                return serializedItem;
            })
        );

        let serializedAudio: SerializedAudioFile | null = null;
        if (audioFile) {
            const path = `users/${user.uid}/slideshows/${slideshowId}/${audioFile.name}`;
            const { url, storagePath } = await uploadFile(audioFile, path);
            serializedAudio = { name: audioFile.name, url, storagePath };
        }
        
        const currentSettings: SlideshowSettings = { interval, slideStyle, showClock, smartCaptionsEnabled };

        const dataToSave = {
            userId: user.uid,
            name: slideshowName,
            media: serializedMedia,
            audio: serializedAudio,
            settings: currentSettings,
            // Fix: Use modular Firebase functions.
            timestamp: serverTimestamp(),
        };

        // Optimistic UI Update
        const clientTimestamp = Timestamp.now();
        if (isNewSlideshow) {
            const newSlideshowEntry: SavedSlideshow = {
                id: slideshowId,
                userId: user.uid,
                name: slideshowName,
                media: serializedMedia,
                audio: serializedAudio,
                settings: currentSettings,
                timestamp: clientTimestamp,
            };
            setSavedSlideshows(prev => [newSlideshowEntry, ...prev]);
            setActiveSlideshowId(slideshowId);
        } else {
            setSavedSlideshows(prev => prev.map(s => 
                s.id === slideshowId 
                ? { ...s, name: slideshowName, media: serializedMedia, audio: serializedAudio, settings: currentSettings, timestamp: clientTimestamp }
                : s
            ).sort((a, b) => (b.timestamp?.toMillis() ?? 0) - (a.timestamp?.toMillis() ?? 0)));
        }

        // Fix: Use modular Firebase functions.
        await setDoc(doc(db, "slideshows", slideshowId), dataToSave, { merge: true });

        alert(`Slideshow "${slideshowName}" saved successfully!`);
    } catch(error) {
        console.error("Error saving slideshow:", error);
        alert(`There was an error saving your slideshow. ${error instanceof Error ? error.message : ''}`);
    } finally {
        setIsSaving(false);
    }
  }, [user, activeSlideshowId, activeSlideshowName, media, audioFile, interval, slideStyle, showClock, smartCaptionsEnabled]);

  const handleLoadSlideshow = useCallback(async (id: string) => {
    const slideshowToLoad = savedSlideshows.find(s => s.id === id);
    if (!slideshowToLoad) return;
    
    setIsLoading(true);
    try {
        handleNewSlideshow();

        const loadedMedia: MediaFile[] = await Promise.all(
            slideshowToLoad.media.map(async (m) => {
                const file = await urlToFile(m.url, m.name);
                const previewUrl = URL.createObjectURL(file);
                if (m.type === 'image') {
                    return {
                        id: m.id,
                        type: 'image',
                        file,
                        previewUrl,
                        caption: m.caption,
                    };
                } else {
                     return {
                        id: m.id,
                        type: 'video',
                        file,
                        previewUrl,
                    };
                }
            })
        );
        
        const loadedAudio = slideshowToLoad.audio ? await urlToFile(slideshowToLoad.audio.url, slideshowToLoad.audio.name) : null;
        
        setMedia(loadedMedia);
        setAudioFile(loadedAudio);
        setIntervalValue(slideshowToLoad.settings.interval);
        setSlideStyle(slideshowToLoad.settings.slideStyle);
        setShowClock(slideshowToLoad.settings.showClock);
        setSmartCaptionsEnabled(slideshowToLoad.settings.smartCaptionsEnabled);
        setActiveSlideshowId(id);
    } catch (error) {
        console.error("Error loading slideshow:", error);
        alert("There was an error loading the slideshow.");
    } finally {
        setIsLoading(false);
    }
  }, [savedSlideshows, handleNewSlideshow]);

  const handleDeleteSlideshow = useCallback(async (id: string) => {
    const slideshowToDelete = savedSlideshows.find(s => s.id === id);
    if (!slideshowToDelete) return;

    if (window.confirm(`Are you sure you want to delete "${slideshowToDelete.name}"?`)) {
        setIsLoading(true);
        try {
            // Step 1: Perform all remote deletion operations.
            const filePaths = slideshowToDelete.media.map(m => m.storagePath);
            if (slideshowToDelete.audio) {
                filePaths.push(slideshowToDelete.audio.storagePath);
            }

            await Promise.all(filePaths.map(path => {
                const fileRef = ref(storage, path);
                return deleteObject(fileRef);
            }));

            await deleteDoc(doc(db, "slideshows", id));
            
            // Step 2: Manually update local state after successful remote deletion.
            // This avoids race conditions with the onSnapshot listener.
            // The listener will eventually fire, but our state will already be correct.
            setSavedSlideshows(prev => prev.filter(s => s.id !== id));
            if (activeSlideshowId === id) {
                handleNewSlideshow();
            }

        } catch (error) {
            console.error("Error deleting slideshow:", error);
            alert("Failed to delete slideshow.");
        } finally {
            setIsLoading(false);
        }
    }
  }, [savedSlideshows, activeSlideshowId, handleNewSlideshow]);
  

  // --- EFFECTS ---
  // Authentication Effect
  useEffect(() => {
    // Fix: Use modular Firebase functions.
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        setUser(currentUser);
        setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Check for Gemini API Key
  useEffect(() => {
    try {
      const apiKey = process.env.API_KEY;
      setIsApiKeyAvailable(!!apiKey);
    } catch (e) {
      setIsApiKeyAvailable(false);
    }
  }, []);

  // Firebase Data Sync Effect
  useEffect(() => {
    // If a user is logged in, set up a real-time listener for their slideshows.
    if (user && user.uid) {
        setIsLoading(true);
        const slideshowsCollectionRef = collection(db, 'slideshows');
        const q = query(slideshowsCollectionRef, where('userId', '==', user.uid), orderBy('timestamp', 'desc'));
        
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const slideshowsData = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
            })) as SavedSlideshow[];
            setSavedSlideshows(slideshowsData);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching slideshows:", error);
            setIsLoading(false);
        });

        // Cleanup the listener when the user logs out or the component unmounts.
        return () => unsubscribe();
    } else if (!authLoading) {
        // This condition is crucial to prevent data from being cleared during the
        // initial authentication check. It only runs when we know for sure that
        // the user is logged out, not just in a temporary pre-auth state.
        setSavedSlideshows([]);
        handleNewSlideshow(); 
        setIsLoading(false);
    }
  }, [user, authLoading, handleNewSlideshow]);


  // Caption Generation Effect
  useEffect(() => {
    if (smartCaptionsEnabled && captionStatus !== 'done') {
      generateCaptions();
    }
    if (media.length === 0) {
        setCaptionStatus('idle');
    }
  }, [smartCaptionsEnabled, media, generateCaptions, captionStatus]);

  // Slide Speed Auto-Adjustment Effect
  useEffect(() => {
    if (isAutoAdjusting.current) {
        isAutoAdjusting.current = false;
        return;
    }

    if (!audioFile || imageCount === 0) {
        if (adjustmentNotification) setAdjustmentNotification(null);
        return;
    }

    const calculateAndAdjust = async () => {
        const audioDuration = await new Promise<number>(resolve => {
            const audioEl = document.createElement('audio');
            audioEl.preload = 'metadata';
            audioEl.onloadedmetadata = () => {
                window.URL.revokeObjectURL(audioEl.src);
                resolve(audioEl.duration);
            };
            audioEl.src = URL.createObjectURL(audioFile);
        });

        const videoFiles = media.filter((m): m is VideoFile => m.type === 'video');
        const videoDurations = await Promise.all(
            videoFiles.map(v => new Promise<number>(resolve => {
                const videoEl = document.createElement('video');
                videoEl.preload = 'metadata';
                videoEl.onloadedmetadata = () => {
                    window.URL.revokeObjectURL(videoEl.src);
                    resolve(videoEl.duration);
                };
                videoEl.src = URL.createObjectURL(v.file);
            }))
        );
        const totalVideoDuration = videoDurations.reduce((sum, duration) => sum + duration, 0);

        const currentTotalSlideshowDuration = (imageCount * interval) + totalVideoDuration;

        if (audioDuration < currentTotalSlideshowDuration) {
            const availableTimeForImages = audioDuration - totalVideoDuration;
            if (availableTimeForImages > 0) {
                const newInterval = Math.max(1, Math.floor(availableTimeForImages / imageCount));
                if (newInterval !== interval) {
                    isAutoAdjusting.current = true;
                    setIntervalValue(newInterval);
                    setAdjustmentNotification(`Slide speed automatically adjusted to ${newInterval}s to match song length.`);
                }
            } else { 
                if (interval !== 1) {
                     isAutoAdjusting.current = true;
                     setIntervalValue(1);
                     setAdjustmentNotification(`Song is shorter than video content. Slide speed set to minimum (1s).`);
                }
            }
        } else {
            if (adjustmentNotification) setAdjustmentNotification(null);
        }
    };

    calculateAndAdjust();

  }, [audioFile, media, interval, imageCount, adjustmentNotification]);

  // --- EVENT HANDLERS ---
  const handleMediaUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    let updatedMedia = [...media];

    const processFiles = async () => {
      for (const file of files) {
        if (!(file instanceof File)) continue;
        const currentImagesCount = updatedMedia.filter(m => m.type === 'image').length;
        const currentVideosCount = updatedMedia.filter(m => m.type === 'video').length;

        if (file.type.startsWith('image/')) {
          if (currentImagesCount < MAX_IMAGES) {
            updatedMedia.push({
              id: `${file.name}-${Date.now()}`,
              type: 'image',
              file: file,
              previewUrl: URL.createObjectURL(file),
            });
          } else {
            alert(`Maximum of ${MAX_IMAGES} images reached. Some images were not uploaded.`);
            break; 
          }
        } else if (file.type.startsWith('video/')) {
          if (currentVideosCount < MAX_VIDEOS) {
            const duration = await new Promise<number>((resolve) => {
              const videoEl = document.createElement('video');
              videoEl.preload = 'metadata';
              videoEl.onloadedmetadata = () => {
                window.URL.revokeObjectURL(videoEl.src);
                resolve(videoEl.duration);
              };
              videoEl.src = URL.createObjectURL(file);
            });

            if (duration > MAX_VIDEO_DURATION) {
              alert(`Video "${file.name}" exceeds the ${MAX_VIDEO_DURATION}s limit and was not uploaded.`);
              continue;
            }
            
            updatedMedia.push({
              id: `${file.name}-${Date.now()}`,
              type: 'video',
              file: file,
              previewUrl: URL.createObjectURL(file),
            });

          } else {
            alert(`Maximum of ${MAX_VIDEOS} video reached. Some videos were not uploaded.`);
          }
        }
      }
      setMedia(updatedMedia);
    };

    processFiles();
  };
  
  const removeMedia = (id: string) => {
    setMedia(prev => prev.filter(item => {
        if (item.id === id) {
            URL.revokeObjectURL(item.previewUrl);
            return false;
        }
        return true;
    }));
  };

  const handleAudioUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setAudioFile(file);
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, id: string) => {
    setDraggedItemId(id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); 
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain');
    if (sourceId && sourceId !== targetId) {
        setMedia(prevMedia => {
            const sourceIndex = prevMedia.findIndex(item => item.id === sourceId);
            const targetIndex = prevMedia.findIndex(item => item.id === targetId);
            if (sourceIndex === -1 || targetIndex === -1) return prevMedia;

            const newMedia = [...prevMedia];
            const [draggedItem] = newMedia.splice(sourceIndex, 1);
            newMedia.splice(targetIndex, 0, draggedItem);
            return newMedia;
        });
    }
    setDraggedItemId(null);
  };

  const handleDragEnd = () => {
    setDraggedItemId(null);
  };

  const handleSignIn = async () => {
    setAuthError(null);
    try {
        // Fix: Use modular Firebase functions.
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    } catch (error: any) {
        console.error("Authentication error:", error);
        setAuthError(error.message || "Failed to sign in.");
    }
  };

  const handleSignOut = async () => {
    try {
        // Fix: Use modular Firebase functions.
        await signOut(auth);
    } catch (error) {
        console.error("Sign out error:", error);
    }
  };


  const isReadyToPlay = media.length > 0 && audioFile;
  const isWorking = captionStatus === 'generating' || isLoading || authLoading || isSaving;

  if (authLoading) {
    return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
            <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-purple-500"></div>
        </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={handleSignIn} error={authError} />;
  }


  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-10 flex-wrap gap-4">
            <div className="flex items-center gap-4">
                <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-600">
                Muziq Slides
                </h1>
                <button onClick={() => setShowInfoModal(true)} className="text-gray-400 hover:text-white transition-colors" aria-label="About this app">
                    <InfoIcon className="w-8 h-8" />
                </button>
            </div>
            <div className="flex items-center gap-4">
                {user.photoURL && <img src={user.photoURL} alt={user.displayName || 'User'} className="w-10 h-10 rounded-full" />}
                <button onClick={handleSignOut} className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 px-4 rounded-md transition-colors">
                    Sign Out
                </button>
            </div>
        </header>

        <main className="space-y-12">
          {/* Step 1: My Slideshows */}
          <section className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 shadow-lg">
            <h2 className="text-2xl font-semibold mb-4 border-b border-gray-600 pb-2">1. My Slideshows</h2>
            {isLoading && !isSaving && <p className="text-center text-purple-400">Loading your slideshows...</p>}
            {!isLoading && savedSlideshows.length === 0 && (
                <div className="text-center py-4">
                    <p className="text-gray-400 mb-4">You have no saved slideshows. Start by creating one below!</p>
                </div>
            )}
            {!isLoading && savedSlideshows.length > 0 && (
                <div className="space-y-3 mb-4 max-h-60 overflow-y-auto pr-2">
                    {savedSlideshows.map(s => (
                        <div key={s.id} className={`p-3 rounded-md flex items-center justify-between gap-4 transition-all ${activeSlideshowId === s.id ? 'bg-purple-900/50 ring-2 ring-purple-500' : 'bg-gray-700/50'}`}>
                            <div>
                                <p className="font-semibold text-white">{s.name}</p>
                                <p className="text-xs text-gray-400">Saved: {s.timestamp?.toDate().toLocaleString()}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => handleLoadSlideshow(s.id)} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-3 rounded-md transition-colors text-sm">Load</button>
                                <button onClick={() => handleDeleteSlideshow(s.id)} className="bg-red-600 hover:bg-red-500 text-white font-bold p-2 rounded-md transition-colors"><TrashIcon className="w-5 h-5"/></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
             <button onClick={handleNewSlideshow} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-md transition-colors">
                + Start a New Slideshow
            </button>
          </section>

          <h2 className="text-3xl font-bold text-center text-purple-300 border-t border-b border-gray-700 py-2">
              Editing: <span className="text-white">{activeSlideshowName}</span>
          </h2>


          {/* Step 2: Media Upload */}
          <section className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 shadow-lg">
            <h2 className="text-2xl font-semibold mb-4 border-b border-gray-600 pb-2">2. Upload Your Media (up to {MAX_IMAGES} images & {MAX_VIDEOS} video)</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-4">
              {media.map(item => (
                <div 
                    key={item.id} 
                    className={`relative group aspect-square cursor-move transition-opacity duration-300 ${draggedItemId === item.id ? 'opacity-30' : 'opacity-100'}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, item.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, item.id)}
                    onDragEnd={handleDragEnd}
                >
                  {item.type === 'image' ? (
                      <img src={item.previewUrl} alt={item.file.name} className="w-full h-full object-cover rounded-md shadow-md pointer-events-none"/>
                  ) : (
                      <video src={item.previewUrl} className="w-full h-full object-cover rounded-md shadow-md pointer-events-none" />
                  )}
                  {item.type === 'video' && (
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center rounded-md pointer-events-none">
                      <FilmIcon className="w-8 h-8 text-white opacity-75" />
                    </div>
                  )}
                  <button onClick={() => removeMedia(item.id)} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-pointer">
                    <XIcon className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {(imageCount < MAX_IMAGES || videoCount < MAX_VIDEOS) && (
                <button onClick={() => mediaInputRef.current?.click()} className="flex items-center justify-center aspect-square border-2 border-dashed border-gray-500 rounded-md hover:bg-gray-700 hover:border-purple-500 transition-colors">
                  <UploadIcon className="w-8 h-8 text-gray-400" />
                </button>
              )}
            </div>
            <input type="file" ref={mediaInputRef} onChange={handleMediaUpload} accept="image/*,video/*" multiple className="hidden"/>
            <p className="text-sm text-gray-400">{imageCount} / {MAX_IMAGES} images | {videoCount} / {MAX_VIDEOS} video uploaded.</p>
            <p className="text-sm text-gray-500 mt-2">Tip: Drag and drop your media to change the order.</p>
          </section>

          {/* Step 3: Audio Upload */}
          <section className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 shadow-lg">
            <h2 className="text-2xl font-semibold mb-4 border-b border-gray-600 pb-2">3. Add Your Music</h2>
            <div className="flex items-center space-x-4">
              <button onClick={() => audioInputRef.current?.click()} className="flex-shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-md transition-colors flex items-center space-x-2">
                <MusicIcon className="w-5 h-5"/>
                <span>{audioFile ? "Change Song" : "Select Song"}</span>
              </button>
              {audioFile && <p className="text-gray-300 truncate">{audioFile.name}</p>}
            </div>
            <input type="file" ref={audioInputRef} onChange={handleAudioUpload} accept="audio/*" className="hidden"/>
          </section>

          {/* Step 4: Settings */}
          <section className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 shadow-lg">
            <h2 className="text-2xl font-semibold mb-4 border-b border-gray-600 pb-2">4. Configure Slideshow</h2>
            <div className="space-y-6">
                <div>
                    <label className="block mb-2 font-medium text-gray-300">Slide Speed (seconds)</label>
                    {adjustmentNotification && (
                        <div className="bg-indigo-900/50 text-indigo-200 text-sm p-3 rounded-md mb-3 flex items-center gap-2">
                            <InfoIcon className="w-5 h-5 flex-shrink-0" />
                            <span>{adjustmentNotification}</span>
                        </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                    {[1, 5, 10, 15, 20].map(val => (
                        <button key={val} onClick={() => setIntervalValue(val)} className={`px-4 py-2 rounded-md font-semibold transition-colors ${interval === val ? 'bg-purple-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>
                        {val}s
                        </button>
                    ))}
                    </div>
                </div>
                <div>
                    <label className="block mb-2 font-medium text-gray-300">Slide Style</label>
                     <div className="flex flex-wrap gap-2">
                        {[
                            { id: 'fade', name: 'Fade' },
                            { id: 'kenburns', name: 'Ken Burns' },
                            { id: 'slideright', name: 'Slide Right' },
                            { id: 'slidebottom', name: 'Slide Bottom' },
                            { id: 'zoomin', name: 'Zoom In' },
                        ].map(style => (
                            <button key={style.id} onClick={() => setSlideStyle(style.id)} className={`px-4 py-2 rounded-md font-semibold transition-colors ${slideStyle === style.id ? 'bg-purple-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>
                                {style.name}
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <label className="block mb-2 font-medium text-gray-300">Display Options</label>
                    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                        <ToggleSwitch enabled={showClock} onChange={setShowClock} label="Date and Clock" />
                        <div className="flex items-center gap-3">
                            {isApiKeyAvailable ? (
                                <div className="flex items-center gap-3">
                                    <ToggleSwitch
                                        enabled={smartCaptionsEnabled}
                                        onChange={setSmartCaptionsEnabled}
                                        label="Smart Captions"
                                    />
                                    {captionStatus === 'generating' && <div className="w-5 h-5 border-2 border-dashed rounded-full animate-spin border-purple-400"></div>}
                                    {captionStatus === 'error' && <p className="text-sm text-red-400">Error.</p>}
                                </div>
                            ) : (
                                <Tooltip message="The Google AI API key is not configured. This feature is unavailable.">
                                    <div className="flex items-center gap-3">
                                        <ToggleSwitch
                                            enabled={false}
                                            onChange={() => {}}
                                            label="Smart Captions"
                                            disabled={true}
                                        />
                                        <InfoIcon className="w-5 h-5 text-yellow-400" />
                                    </div>
                                </Tooltip>
                            )}
                        </div>
                    </div>
                </div>
            </div>
          </section>
          
          {/* Step 5: Finalize */}
          <section className="text-center py-6">
            <div className="flex justify-center items-center flex-wrap gap-4">
                <button onClick={handleSaveSlideshow} disabled={!isReadyToPlay || isWorking} className="flex items-center space-x-2 text-lg font-bold bg-indigo-600 hover:bg-indigo-500 text-white py-3 px-8 rounded-lg transition-all disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 shadow-lg">
                    <SaveIcon className="w-6 h-6" />
                    <span>{isSaving ? "Saving..." : (activeSlideshowId ? "Update" : "Save")}</span>
                </button>
                <button onClick={() => setIsPlaying(true)} disabled={!isReadyToPlay || isWorking} className="flex items-center space-x-2 text-lg font-bold bg-green-600 hover:bg-green-500 text-white py-3 px-8 rounded-lg transition-all disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 shadow-lg">
                  <PlayIcon className="w-6 h-6"/>
                  <span>Preview</span>
                </button>
                <button onClick={() => setShowPublishedModal(true)} disabled={!isReadyToPlay || isWorking} className="text-lg font-bold bg-blue-600 hover:bg-blue-500 text-white py-3 px-8 rounded-lg transition-all disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 shadow-lg">
                  Publish
                </button>
            </div>
            {!isReadyToPlay && <p className="mt-4 text-yellow-400">Please upload at least one image/video and one audio file to proceed.</p>}
            {isWorking && <p className="mt-4 text-purple-400">Working, please wait...</p>}
          </section>
        </main>
      </div>

      {isPlaying && isReadyToPlay && (
        <SlideshowPlayer 
          media={media}
          audioFile={audioFile}
          interval={interval}
          onClose={() => setIsPlaying(false)}
          slideStyle={slideStyle}
          showClock={showClock}
          smartCaptionsEnabled={smartCaptionsEnabled}
        />
      )}
      
      {showInfoModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in">
            <div className="bg-gray-800 p-8 rounded-lg max-w-2xl text-left border border-purple-500 shadow-2xl relative w-full m-4">
                <button 
                    onClick={() => setShowInfoModal(false)} 
                    className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                    aria-label="Close"
                >
                    <XIcon className="w-6 h-6" />
                </button>
                <h3 className="text-2xl font-bold text-purple-400 mb-4">About Muziq Slides</h3>
                <p className="text-gray-300 mb-6">
                    Muziq Slides helps you create beautiful, personalized photo slideshows with your favorite music. It's perfect for reliving memories, creating a custom screensaver, or sharing a visual story with friends and family.
                </p>
                <h4 className="text-xl font-semibold text-purple-300 mb-3">How to Use:</h4>
                <ol className="list-decimal list-inside space-y-2 text-gray-300">
                    <li><strong>Sign In:</strong> Use your Google account to sign in. Your slideshows will be saved securely to your account.</li>
                    <li><strong>Manage Slideshows:</strong> Use the "My Slideshows" area to save, load, delete, or start new projects.</li>
                    <li><strong>Upload Media:</strong> Click the upload area to select up to {MAX_IMAGES} images and {MAX_VIDEOS} video (max 30s). You can remove any item by hovering over it and clicking the 'X' button. You can also drag-and-drop media to reorder it.</li>
                    <li><strong>Add Music:</strong> Click 'Select Song' to choose an audio file from your device. This will be the soundtrack for your slideshow.</li>
                    <li><strong>Configure:</strong> Adjust the settings to your liking.
                        <ul className="list-disc list-inside ml-6 mt-2 text-gray-400">
                            <li><strong>Slide Speed:</strong> How long each photo is displayed. Videos play for their full duration.</li>
                            <li><strong>Slide Style:</strong> The transition animation between photos.</li>
                            <li><strong>Display Options:</strong> Toggle the date/clock or enable AI-powered 'Smart Captions' for your images.</li>
                        </ul>
                    </li>
                    <li><strong>Finalize:</strong> Once you'veuploaded media and a song, you can save your progress, preview the slideshow, or use the 'Publish' button to simulate sending it to a smart TV screensaver.</li>
                </ol>
                <div className="text-right mt-8">
                    <button onClick={() => setShowInfoModal(false)} className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 px-6 rounded-md transition-colors">
                        Got it!
                    </button>
                </div>
            </div>
        </div>
      )}

      {showPublishedModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in">
            <div className="bg-gray-800 p-8 rounded-lg max-w-md text-center border border-purple-500 shadow-2xl">
                <h3 className="text-2xl font-bold text-green-400 mb-4">Published Successfully!</h3>
                <p className="text-gray-300 mb-6">
                    Your "Muziq Slides" has been sent to your connected <strong>Roku Photo Streams</strong> and <strong>Amazon Fire TV Screensaver</strong>. It will appear on your devices shortly.
                </p>
                <p className="text-xs text-gray-500 mb-6">(This is a simulation. No actual data has been sent.)</p>
                <button onClick={() => setShowPublishedModal(false)} className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 px-6 rounded-md transition-colors">
                    Close
                </button>
            </div>
        </div>
      )}
    </div>
  );
}


// --- SLIDESHOW PLAYER COMPONENT ---
interface SlideshowPlayerProps {
    media: MediaFile[];
    audioFile: File;
    interval: number;
    onClose: () => void;
    slideStyle: string;
    showClock: boolean;
    smartCaptionsEnabled: boolean;
}

const SlideshowPlayer: React.FC<SlideshowPlayerProps> = ({ media, audioFile, interval, onClose, slideStyle, showClock, smartCaptionsEnabled }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const audioRef = useRef<HTMLAudioElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const fadeOutIntervalRef = useRef<number | null>(null);

    const audioUrl = useMemo(() => URL.createObjectURL(audioFile), [audioFile]);

    const cleanup = useCallback(() => {
        URL.revokeObjectURL(audioUrl);
        if (fadeOutIntervalRef.current) {
            clearInterval(fadeOutIntervalRef.current);
        }
    }, [audioUrl]);
    
    const advanceSlide = useCallback(() => {
        setCurrentIndex(prev => (prev + 1) % media.length);
    }, [media.length]);

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            onClose();
          }
        };
        window.addEventListener('keydown', handleKeyDown);
        
        return () => {
            document.body.style.overflow = 'auto';
            window.removeEventListener('keydown', handleKeyDown);
            cleanup();
        };
    }, [onClose, cleanup]);
    
    // Timer to advance the slide (for images only)
    useEffect(() => {
        if (media.length < 2) return;
        
        const currentItem = media[currentIndex];
        let slideTimer: number | undefined;

        if (currentItem.type === 'image') {
            slideTimer = window.setInterval(advanceSlide, interval * 1000);
        }

        return () => {
            if (slideTimer) clearInterval(slideTimer);
        }
    }, [media, currentIndex, interval, advanceSlide]);
    
    // Autoplay video when its slide is active
    useEffect(() => {
        const currentItem = media[currentIndex];
        if (currentItem.type === 'video' && videoRef.current) {
            videoRef.current.currentTime = 0;
            videoRef.current.play().catch(error => console.warn("Video playback failed:", error));
        }
    }, [currentIndex, media]);


    // Audio control for fade-out and looping
    useEffect(() => {
        const audioEl = audioRef.current;
        if (!audioEl) return;

        if (fadeOutIntervalRef.current) {
            clearInterval(fadeOutIntervalRef.current);
            fadeOutIntervalRef.current = null;
        }

        if (currentIndex === 0) {
            audioEl.volume = 1.0;
            audioEl.currentTime = 0;
            audioEl.play().catch(error => console.warn("Audio playback failed:", error));
        }

        if (currentIndex === media.length - 1 && media.length > 1) {
            const fadeDurationMs = interval * 1000;
            if (fadeDurationMs <= 0) return;

            const tickIntervalMs = 50;
            const totalTicks = fadeDurationMs / tickIntervalMs;
            const volumeDecrement = audioEl.volume / totalTicks;

            fadeOutIntervalRef.current = window.setInterval(() => {
                if (audioEl) {
                    audioEl.volume = Math.max(0, audioEl.volume - volumeDecrement);
                    if (audioEl.volume <= 0) {
                        if (fadeOutIntervalRef.current) clearInterval(fadeOutIntervalRef.current);
                        fadeOutIntervalRef.current = null;
                    }
                }
            }, tickIntervalMs);
        }
    }, [currentIndex, media.length, interval]);
    
    const getAnimationClass = (style: string) => {
        switch (style) {
            case 'kenburns': return 'animate-ken-burns';
            case 'slideright': return 'animate-slide-from-right';
            case 'slidebottom': return 'animate-slide-from-bottom';
            case 'zoomin': return 'animate-zoom-in';
            case 'fade':
            default:
                return 'animate-fade-in';
        }
    };

    const ClockDisplay: React.FC = () => {
        const [time, setTime] = useState(new Date());
        useEffect(() => {
            const timer = setInterval(() => setTime(new Date()), 1000);
            return () => clearInterval(timer);
        }, []);

        return (
            <div className="absolute top-4 right-4 bg-black/40 text-white p-3 rounded-lg text-lg font-mono shadow-lg z-20 text-right">
                <p>{time.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                <p className="text-2xl">{time.toLocaleTimeString()}</p>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-black z-50 flex items-center justify-center animate-fade-in" onContextMenu={(e) => e.preventDefault()}>
            <div className="w-full h-full relative overflow-hidden">
                {showClock && <ClockDisplay />}
                {media.map((item, index) => (
                    <div key={item.id} className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${index === currentIndex ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}>
                         {index === currentIndex && (
                             item.type === 'image' ? (
                                <img 
                                    src={item.previewUrl} 
                                    alt={`Slideshow item ${index + 1}`} 
                                    className={`w-full h-full object-contain ${getAnimationClass(slideStyle)}`} 
                                />
                             ) : (
                                <video
                                    ref={videoRef}
                                    src={item.previewUrl}
                                    onEnded={advanceSlide}
                                    muted
                                    className="w-full h-full object-contain"
                                />
                             )
                         )}
                        {smartCaptionsEnabled && item.type === 'image' && item.caption && index === currentIndex && (
                            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/70 to-transparent z-20 animate-fade-in">
                                <p className="text-center text-white text-xl sm:text-2xl drop-shadow-lg">
                                    {item.caption}
                                </p>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <button onClick={onClose} className="absolute top-4 left-4 text-white bg-black/50 p-2 rounded-full hover:bg-black/75 transition-colors z-30">
                <XIcon className="w-8 h-8"/>
                <span className="sr-only">Close Slideshow</span>
            </button>

            <audio ref={audioRef} src={audioUrl} autoPlay onCanPlay={(e) => e.currentTarget.volume = 1.0}></audio>
        </div>
    );
};
