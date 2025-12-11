import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
// Fix: Corrected Firebase imports to use the v9 modular SDK style (e.g., 'firebase/app')
// which resolves build errors caused by referencing non-existent scoped packages.
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
    updateDoc,
    arrayUnion,
    arrayRemove,
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
  caption: string;
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
    // Fields for sharing functionality
    ownerInfo?: {
        displayName: string | null;
        photoURL: string | null;
    };
    sharedWith?: string[]; // Array of user emails
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

// --- CONSTANTS ---
const SLIDE_STYLES = [
    { id: 'ken-burns', name: 'Ken Burns' },
    { id: 'fade-in', name: 'Fade In' },
    { id: 'slide-from-right', name: 'Slide Right' },
    { id: 'slide-from-bottom', name: 'Slide Up' },
    { id: 'zoom-in', name: 'Zoom In' },
    { id: 'zoom-out', name: 'Zoom Out' },
];

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
const QuestionMarkCircleIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);
const SettingsIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.096 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
);
const ShareIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.368a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
    </svg>
);
const SparklesIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="currentColor" viewBox="0 0 24 24">
        <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.321l5.478.698a.563.563 0 01.31.95l-4.233 3.585a.563.563 0 00-.154.543l1.232 5.022a.563.563 0 01-.82.63l-4.735-2.79a.563.563 0 00-.536 0l-4.735 2.79a.563.563 0 01-.82-.63l1.232-5.022a.563.563 0 00-.154-.543l-4.233-3.585a.563.563 0 01.31-.95l5.478-.698a.563.563 0 00.475-.321L11.48 3.5z" />
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
        repeatSlideshow: false,
        showCaptions: true,
    });
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [slideshowName, setSlideshowName] = useState('');
    const [currentSlideshowId, setCurrentSlideshowId] = useState<string | null>(null);
    const [ownedSlideshows, setOwnedSlideshows] = useState<SavedSlideshow[]>([]);
    const [sharedSlideshows, setSharedSlideshows] = useState<SavedSlideshow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false); // For loading/deleting
    const [error, setError] = useState<string | null>(null);
    const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
    
    // Sharing state
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [slideshowToShare, setSlideshowToShare] = useState<SavedSlideshow | null>(null);
    const [shareEmail, setShareEmail] = useState('');
    const [isSharing, setIsSharing] = useState(false);

    // AI Caption state
    const [generatingCaptionId, setGeneratingCaptionId] = useState<string | null>(null);

    // Drag and Drop state
    const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    const audioRef = useRef<HTMLAudioElement>(null);
    const videoPreviewRef = useRef<HTMLVideoElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);

    // Fix: Memoize the audio object URL to prevent it from being regenerated on every
    // render, which was causing the audio to restart on each slide transition.
    const audioSrc = useMemo(() => {
        return audioFile ? URL.createObjectURL(audioFile.file) : null;
    }, [audioFile]);

    // Add cleanup for the object URL to prevent memory leaks
    useEffect(() => {
        // This is a cleanup function that will run when the audioSrc changes or component unmounts.
        return () => {
            if (audioSrc) {
                URL.revokeObjectURL(audioSrc);
            }
        };
    }, [audioSrc]);


    // --- AUTHENTICATION & DATA FETCHING ---
    useEffect(() => {
        setIsLoading(true);
        const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            if (!currentUser) {
                setIsLoading(false);
                setOwnedSlideshows([]);
                setSharedSlideshows([]);
            }
        });
        return unsubscribeAuth;
    }, []);
    
    useEffect(() => {
        if (user?.uid && user?.email) {
            setIsLoading(true);

            // Listener for slideshows owned by the user
            const ownedQuery = query(collection(db, "slideshows"), where("userId", "==", user.uid), orderBy("timestamp", "desc"));
            const unsubscribeOwned = onSnapshot(ownedQuery, (querySnapshot) => {
                const slideshows: SavedSlideshow[] = [];
                querySnapshot.forEach((doc) => {
                    slideshows.push({ id: doc.id, ...doc.data() } as SavedSlideshow);
                });
                setOwnedSlideshows(slideshows);
                setIsLoading(false);
            }, (err) => {
                console.error("Error fetching owned slideshows:", err);
                setError("Could not load your saved slideshows.");
                setIsLoading(false);
            });

            // Listener for slideshows shared with the user
            const sharedQuery = query(collection(db, "slideshows"), where("sharedWith", "array-contains", user.email));
            const unsubscribeShared = onSnapshot(sharedQuery, (querySnapshot) => {
                const slideshows: SavedSlideshow[] = [];
                querySnapshot.forEach((doc) => {
                    slideshows.push({ id: doc.id, ...doc.data() } as SavedSlideshow);
                });
                setSharedSlideshows(slideshows);
            }, (err) => {
                console.error("Error fetching shared slideshows:", err);
            });

            return () => {
                unsubscribeOwned();
                unsubscribeShared();
            };
        } else {
            setOwnedSlideshows([]);
            setSharedSlideshows([]);
        }
    }, [user]);

    const allSlideshows = useMemo(() => {
        const combined = [...ownedSlideshows, ...sharedSlideshows];
        const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
        return unique.sort((a, b) => (b.timestamp?.toMillis() ?? 0) - (a.timestamp?.toMillis() ?? 0));
    }, [ownedSlideshows, sharedSlideshows]);

    const handleLogin = async () => {
        const provider = new GoogleAuthProvider();
        try {
            await setPersistence(auth, browserLocalPersistence);
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Authentication error:", error);
            setError("Failed to sign in with Google. Please try again.");
        }
    };

    const handleLogout = async () => {
        try {
            await signOut(auth);
            resetWorkspace();
            setOwnedSlideshows([]);
            setSharedSlideshows([]);
        } catch (error) {
            console.error("Sign out error:", error);
            setError("Failed to sign out. Please try again.");
        }
    };
    
    const resetWorkspace = () => {
        setMediaFiles([]);
        setAudioFile(null);
        setSlideshowName('');
        setCurrentSlideshowId(null);
        if(fileInputRef.current) fileInputRef.current.value = '';
        if(audioInputRef.current) audioInputRef.current.value = '';
    }

    // --- FILE HANDLING ---
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files).slice(0, 20 - mediaFiles.length);
            // FIX: Explicitly type `file` as `File` in the map callback to resolve a
            // potential type inference issue where it was being treated as `unknown`.
            const newMediaFiles: MediaFile[] = files.map((file: File) => {
                 if (file.type.startsWith('image/')) {
                    return {
                        id: `${file.name}-${Date.now()}`,
                        file,
                        previewUrl: URL.createObjectURL(file),
                        type: 'image',
                        caption: '',
                    };
                } else {
                     return {
                        id: `${file.name}-${Date.now()}`,
                        file,
                        previewUrl: URL.createObjectURL(file),
                        type: 'video',
                    };
                }
            });
            setMediaFiles(prev => [...prev, ...newMediaFiles]);
        }
    };
    
    const handleCaptionChange = (id: string, newCaption: string) => {
        setMediaFiles(prev => prev.map(media => {
            if (media.id === id && media.type === 'image') {
                return { ...media, caption: newCaption };
            }
            return media;
        }));
    };

    const handleAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setAudioFile({ file: e.target.files[0], name: e.target.files[0].name });
        }
    };

    const handleDeleteMedia = (id: string) => {
        setMediaFiles(prev => prev.filter(media => media.id !== id));
    };

    // --- DRAG AND DROP HANDLERS ---
    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        setDraggedItemIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        // setData is required for Firefox to initiate drag
        e.dataTransfer.setData('text/plain', index.toString());
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault(); // Necessary to allow dropping
        if (index !== dragOverIndex) {
            setDragOverIndex(index);
        }
    };

    const handleDragLeave = () => {
        setDragOverIndex(null);
    };

    const handleDrop = (dropIndex: number) => {
        if (draggedItemIndex === null || draggedItemIndex === dropIndex) {
            setDraggedItemIndex(null);
            setDragOverIndex(null);
            return;
        }

        const newMediaFiles = [...mediaFiles];
        const [draggedItem] = newMediaFiles.splice(draggedItemIndex, 1);
        newMediaFiles.splice(dropIndex, 0, draggedItem);

        setMediaFiles(newMediaFiles);
        setDraggedItemIndex(null);
        setDragOverIndex(null);
    };

    const handleDragEnd = () => {
        setDraggedItemIndex(null);
        setDragOverIndex(null);
    };


    // --- AI CAPTION GENERATION ---
    const handleGenerateCaption = async (mediaId: string, mediaFile: File) => {
        if (!process.env.API_KEY) {
            setError("API key is not configured for AI features.");
            return;
        }
        setGeneratingCaptionId(mediaId);
        setError(null);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const imagePart = await fileToGenerativePart(mediaFile);
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts: [imagePart, { text: "Describe this image in a short, one-sentence caption." }] },
            });
            
            const caption = response.text;
            if (caption) {
                handleCaptionChange(mediaId, caption.trim());
            } else {
                throw new Error("AI did not generate a caption.");
            }
        } catch (err) {
            console.error("AI Caption Generation Error:", err);
            setError("Failed to generate AI caption. Please try again.");
        } finally {
            setGeneratingCaptionId(null);
        }
    };


    // --- SLIDESHOW PLAYBACK ---
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
            audioRef.current.volume = 1;
            // Play audio regardless of whether the first slide is an image or video
            audioRef.current.play().catch(e => console.error("Audio play failed", e));
        }
    };

    const handleClosePreview = () => {
        setIsPlaying(false);
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            audioRef.current.volume = 1; // Reset volume
        }
    };
    
    // Reworked playback logic to mute videos and keep background music playing.
    useEffect(() => {
        let slideTimer: ReturnType<typeof setTimeout> | undefined;
        let fadeStartTimer: ReturnType<typeof setTimeout> | undefined;
        let fadeInterval: ReturnType<typeof setInterval> | undefined;
        const videoElement = videoPreviewRef.current;

        const cleanup = () => {
            if (slideTimer) clearTimeout(slideTimer);
            if (fadeStartTimer) clearTimeout(fadeStartTimer);
            if (fadeInterval) clearInterval(fadeInterval);
        };

        if (!isPlaying || !mediaFiles.length) {
            return cleanup;
        }

        const currentMedia = mediaFiles[currentSlide];
        const isLastSlide = currentSlide === mediaFiles.length - 1;

        const advanceSlide = () => {
            const nextSlideIndex = (currentSlide + 1) % mediaFiles.length;
            if (isLastSlide && !settings.repeatSlideshow) {
                setIsPlaying(false);
            } else {
                 if (nextSlideIndex === 0 && settings.repeatSlideshow && audioRef.current) {
                    audioRef.current.currentTime = 0;
                }
                setCurrentSlide(nextSlideIndex);
            }
        };

        if (currentMedia.type === 'video') {
            // Ensure background music continues playing.
            if (audioRef.current && audioFile && audioRef.current.paused) {
                audioRef.current.play().catch(e => console.error("Audio play failed", e));
            }
            
            // The video element itself is muted via a JSX property.
            if (videoElement) {
                videoElement.play().catch(e => console.error("Video play failed", e));

                const handleVideoEnd = () => advanceSlide();
                videoElement.addEventListener('ended', handleVideoEnd);

                return () => {
                    cleanup();
                    if(videoElement) {
                      videoElement.removeEventListener('ended', handleVideoEnd);
                    }
                };
            }
        } else { // Image
            // This logic will start music or resume it if it was paused.
            if (audioRef.current && audioFile && audioRef.current.paused) {
                audioRef.current.volume = 1;
                audioRef.current.play().catch(e => console.error("Audio play failed", e));
            }
            
            const slideDurationMs = settings.interval * 1000;
            slideTimer = setTimeout(advanceSlide, slideDurationMs);

            if (isLastSlide && !settings.repeatSlideshow && audioRef.current && audioFile) {
                const fadeDuration = Math.min(5000, slideDurationMs);
                const fadeStartTime = Math.max(0, slideDurationMs - fadeDuration);

                fadeStartTimer = setTimeout(() => {
                    if (!audioRef.current) return;
                    let currentVolume = audioRef.current.volume;
                    const steps = 50;
                    const decrement = currentVolume / steps;
                    const intervalTime = fadeDuration / steps;

                    fadeInterval = setInterval(() => {
                        currentVolume -= decrement;
                        if (currentVolume < 0) currentVolume = 0;
                        if (audioRef.current) audioRef.current.volume = currentVolume;
                        if (currentVolume <= 0) {
                            clearInterval(fadeInterval);
                            if (audioRef.current) {
                                audioRef.current.pause();
                                audioRef.current.currentTime = 0;
                            }
                        }
                    }, intervalTime);
                }, fadeStartTime);
            }
        }

        return cleanup;
    }, [isPlaying, currentSlide, mediaFiles, audioFile, settings]);


    
    // --- SAVE/LOAD/DELETE/SHARE LOGIC ---
    const handleSaveSlideshow = async () => {
        if (!user) {
            setError("You must be signed in to save a slideshow.");
            return;
        }
        if (!slideshowName.trim()) {
            setError("Please enter a name for your slideshow.");
            return;
        }
        if (mediaFiles.length === 0) {
            setError("Please add some media before saving.");
            return;
        }

        setIsSaving(true);
        setError(null);

        try {
            const slideshowId = currentSlideshowId || doc(collection(db, 'slideshows')).id;
            
            const serializedMedia: SerializedMediaFile[] = await Promise.all(
                mediaFiles.map(async (media) => {
                    const filePath = `users/${user.uid}/${slideshowId}/${media.file.name}-${media.id}`;
                    const fileRef = ref(storage, filePath);
                    await uploadBytes(fileRef, media.file);
                    const url = await getDownloadURL(fileRef);
                    return {
                        id: media.id,
                        type: media.type,
                        name: media.file.name,
                        url,
                        storagePath: filePath,
                        caption: media.type === 'image' ? media.caption : undefined,
                    };
                })
            );

            let serializedAudio: SerializedAudioFile | null = null;
            if (audioFile) {
                const filePath = `users/${user.uid}/${slideshowId}/${audioFile.file.name}`;
                const fileRef = ref(storage, filePath);
                await uploadBytes(fileRef, audioFile.file);
                const url = await getDownloadURL(fileRef);
                serializedAudio = { name: audioFile.file.name, url, storagePath: filePath };
            }

            if (currentSlideshowId) { // Update existing slideshow
                const updateData = {
                    name: slideshowName.trim(),
                    media: serializedMedia,
                    audio: serializedAudio,
                    settings,
                    timestamp: serverTimestamp() as Timestamp,
                };
                await updateDoc(doc(db, 'slideshows', currentSlideshowId), updateData);
            } else { // Create new slideshow
                const slideshowData: Omit<SavedSlideshow, 'id'> = {
                    userId: user.uid,
                    name: slideshowName.trim(),
                    media: serializedMedia,
                    audio: serializedAudio,
                    settings,
                    timestamp: serverTimestamp() as Timestamp,
                    ownerInfo: {
                        displayName: user.displayName,
                        photoURL: user.photoURL,
                    },
                    sharedWith: [],
                };
                await setDoc(doc(db, 'slideshows', slideshowId), slideshowData);
                setCurrentSlideshowId(slideshowId);
            }

        } catch (err) {
            console.error("Error saving slideshow:", err);
            setError("An error occurred while saving. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleLoadSlideshow = async (slideshow: SavedSlideshow) => {
        setIsProcessing(true);
        setError(null);
        try {
            const newMediaFiles: MediaFile[] = await Promise.all(
                slideshow.media.map(async (media): Promise<MediaFile> => {
                    const file = await urlToFile(media.url, media.name);
                    if (media.type === 'image') {
                        return {
                           id: media.id,
                           type: 'image',
                           file,
                           previewUrl: URL.createObjectURL(file),
                           caption: media.caption || '',
                        };
                    } else {
                        return {
                           id: media.id,
                           type: 'video',
                           file,
                           previewUrl: URL.createObjectURL(file),
                        };
                    }
                })
            );

            let newAudioFile: { file: File; name: string } | null = null;
            if (slideshow.audio) {
                const file = await urlToFile(slideshow.audio.url, slideshow.audio.name);
                newAudioFile = { file, name: file.name };
            }

            setMediaFiles(newMediaFiles);
            setAudioFile(newAudioFile);
            setSettings(slideshow.settings);
            setSlideshowName(slideshow.name);
            setCurrentSlideshowId(slideshow.id);

        } catch (err) {
            console.error("Error loading slideshow:", err);
            setError("Failed to load slideshow assets. Please check your connection.");
        } finally {
            setIsProcessing(false);
        }
    };
    
    const handleDeleteSlideshow = async (slideshow: SavedSlideshow) => {
        if (!user || user.uid !== slideshow.userId) return;
        if (!window.confirm(`Are you sure you want to delete "${slideshow.name}"? This action cannot be undone.`)) return;

        setIsProcessing(true);
        setError(null);
        try {
            const filePaths = slideshow.media.map(m => m.storagePath);
            if (slideshow.audio) filePaths.push(slideshow.audio.storagePath);
            
            await Promise.all(filePaths.map(path => 
                deleteObject(ref(storage, path)).catch(err => console.warn("Asset deletion failed:", path, err))
            ));
            
            await deleteDoc(doc(db, 'slideshows', slideshow.id));

            if (currentSlideshowId === slideshow.id) {
                resetWorkspace();
            }

        } catch (err) {
            console.error("Error deleting slideshow:", err);
            setError("Failed to delete the slideshow. Please try again.");
        } finally {
            setIsProcessing(false);
        }
    };
    
    const handleOpenShareModal = (slideshow: SavedSlideshow) => {
        setSlideshowToShare(slideshow);
        setIsShareModalOpen(true);
    };

    const handleCloseShareModal = () => {
        setIsShareModalOpen(false);
        setSlideshowToShare(null);
        setShareEmail('');
    };

    const handleAddShare = async () => {
        if (!slideshowToShare || !shareEmail.trim() || !user) return;
        const emailToAdd = shareEmail.trim().toLowerCase();
        
        if (!/\S+@\S+\.\S+/.test(emailToAdd)) {
            setError("Please enter a valid email address.");
            return;
        }
        if (emailToAdd === user.email) {
             setError("You can't share a slideshow with yourself.");
             return;
        }

        setIsSharing(true);
        setError(null);
        try {
            const slideshowRef = doc(db, 'slideshows', slideshowToShare.id);
            await updateDoc(slideshowRef, { sharedWith: arrayUnion(emailToAdd) });
            setSlideshowToShare(prev => ({
                ...prev!,
                sharedWith: [...(prev!.sharedWith || []), emailToAdd]
            }));
            setShareEmail('');
        } catch (err) {
            console.error("Error sharing slideshow:", err);
            setError("Failed to add user. Please try again.");
        } finally {
            setIsSharing(false);
        }
    };

    const handleRemoveShare = async (emailToRemove: string) => {
        if (!slideshowToShare) return;

        setIsSharing(true);
        setError(null);
        try {
            const slideshowRef = doc(db, 'slideshows', slideshowToShare.id);
            await updateDoc(slideshowRef, { sharedWith: arrayRemove(emailToRemove) });
             setSlideshowToShare(prev => ({
                ...prev!,
                sharedWith: (prev!.sharedWith || []).filter(e => e !== emailToRemove)
            }));
        } catch (err) {
            console.error("Error removing share:", err);
            setError("Failed to remove user. Please try again.");
        } finally {
            setIsSharing(false);
        }
    };


    return (
        <div className="min-h-screen bg-brand-dark text-gray-200 font-sans">
            {(isSaving || isProcessing) && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
                    <div className="text-center">
                        <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-brand-purple mx-auto"></div>
                        <p className="text-white text-xl mt-4">{isSaving ? 'Saving...' : (isProcessing ? 'Processing...' : 'Loading...')}</p>
                    </div>
                </div>
            )}

            <header className="bg-gray-900/50 backdrop-blur-sm shadow-lg p-4 flex justify-between items-center sticky top-0 z-40">
                <div className="flex items-center gap-4">
                    <h1 className="text-3xl font-bold text-white tracking-wider">
                        <span className="text-brand-purple">Muziq</span> Slides
                    </h1>
                     <button onClick={() => setIsHelpModalOpen(true)} className="text-gray-400 hover:text-white transition-colors" aria-label="Open help guide">
                        <QuestionMarkCircleIcon className="w-7 h-7" />
                    </button>
                </div>
                <div>
                    {isLoading && !user ? (
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

            <main className="p-4 sm:p-8">
                 {!user ? (
                    <div className="text-center py-20 bg-gray-800/50 rounded-lg">
                        <h2 className="text-4xl font-bold mb-4">Welcome to Muziq Slides</h2>
                        <p className="text-xl text-gray-400 mb-8">Sign in to create, save, share, and collaborate on beautiful photo slideshows.</p>
                        <button onClick={handleLogin} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg flex items-center gap-2 transition-colors mx-auto text-lg">
                            <GoogleIcon className="w-6 h-6" />
                            Sign in with Google to Get Started
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Controls Column */}
                        <div className="space-y-6">
                           {/* Uploader */}
                            <div className="bg-gray-800/50 p-6 rounded-lg">
                                <h3 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">1. Upload Media</h3>
                                <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-brand-purple hover:bg-gray-800 transition-colors">
                                    <UploadIcon className="w-12 h-12 mx-auto text-gray-500" />
                                    <p className="mt-2 text-gray-400">Click to upload images/videos</p>
                                    <p className="text-xs text-gray-500">Max 20 files</p>
                                </div>
                                <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept="image/*,video/*" className="hidden" />
                                <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-4">
                                    {mediaFiles.map((media, index) => (
                                        <div 
                                            key={media.id} 
                                            className={`flex flex-col gap-1 transition-all duration-200 cursor-grab active:cursor-grabbing
                                                ${draggedItemIndex === index ? 'opacity-30 scale-95' : 'opacity-100'}
                                                ${dragOverIndex === index ? 'bg-brand-purple/20 rounded-lg' : ''}
                                            `}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, index)}
                                            onDragOver={(e) => handleDragOver(e, index)}
                                            onDragLeave={handleDragLeave}
                                            onDrop={() => handleDrop(index)}
                                            onDragEnd={handleDragEnd}
                                        >
                                            <div className="group relative w-full h-24">
                                                {media.type === 'video' ? (
                                                    <video src={media.previewUrl} className="w-full h-full object-cover rounded-md pointer-events-none" muted />
                                                ) : (
                                                    <img src={media.previewUrl} alt={media.file.name} className="w-full h-full object-cover rounded-md pointer-events-none" />
                                                )}
                                                <button onClick={() => handleDeleteMedia(media.id)} className="absolute top-1 right-1 bg-black/50 rounded-full p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <XIcon className="w-4 h-4" />
                                                </button>
                                            </div>
                                            {media.type === 'image' && (
                                                <div className="relative w-full">
                                                    <input
                                                        type="text"
                                                        value={media.caption}
                                                        onChange={(e) => handleCaptionChange(media.id, e.target.value)}
                                                        placeholder="Caption..."
                                                        maxLength={80}
                                                        className="w-full bg-gray-700 text-white text-xs rounded p-1 border border-transparent focus:outline-none focus:ring-1 focus:ring-brand-purple pr-6"
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                    {settings.smartCaptionsEnabled && (
                                                        <button
                                                            onClick={() => handleGenerateCaption(media.id, media.file)}
                                                            disabled={generatingCaptionId === media.id}
                                                            className="absolute top-1/2 right-1 -translate-y-1/2 text-yellow-400 hover:text-yellow-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                                                            title="Generate AI Caption"
                                                        >
                                                            {generatingCaptionId === media.id ? (
                                                                <div className="w-3 h-3 border-2 border-dashed rounded-full animate-spin border-white"></div>
                                                            ) : (
                                                                <SparklesIcon className="w-4 h-4" />
                                                            )}
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            
                            {/* Music Picker */}
                            <div className="bg-gray-800/50 p-6 rounded-lg">
                                <h3 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">2. Add Music</h3>
                                 <div onClick={() => audioInputRef.current?.click()} className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-brand-purple hover:bg-gray-800 transition-colors">
                                    <MusicIcon className="w-12 h-12 mx-auto text-gray-500" />
                                    <p className="mt-2 text-gray-400">{audioFile ? audioFile.name : 'Click to select an audio file'}</p>
                                </div>
                                <input type="file" ref={audioInputRef} onChange={handleAudioChange} accept="audio/*" className="hidden" />
                                {audioFile && audioSrc && (
                                    <audio ref={audioRef} src={audioSrc} loop className="w-full mt-4" controls />
                                )}
                            </div>

                             {/* Settings */}
                            <div className="bg-gray-800/50 p-6 rounded-lg">
                                <h3 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">3. Settings</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label htmlFor="interval" className="block mb-2 text-sm font-medium text-gray-300">Slide Duration: {settings.interval}s</label>
                                        <input id="interval" type="range" min="1" max="30" value={settings.interval} onChange={(e) => setSettings(s => ({ ...s, interval: parseInt(e.target.value) }))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer" />
                                    </div>
                                    <div>
                                        <label htmlFor="slideStyle" className="block mb-2 text-sm font-medium text-gray-300">Slide Style</label>
                                        <select id="slideStyle" value={settings.slideStyle} onChange={(e) => setSettings(s => ({...s, slideStyle: e.target.value}))} className="bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-brand-purple focus:border-brand-purple block w-full p-2.5">
                                            {SLIDE_STYLES.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="showClock" className="text-sm font-medium text-gray-300">Show Clock in Preview</label>
                                        <button onClick={() => setSettings(s => ({...s, showClock: !s.showClock}))} className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors ${settings.showClock ? 'bg-brand-purple' : 'bg-gray-600'}`}>
                                            <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${settings.showClock ? 'translate-x-6' : 'translate-x-1'}`}/>
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="repeatSlideshow" className="text-sm font-medium text-gray-300">Repeat Slideshow</label>
                                        <button onClick={() => setSettings(s => ({...s, repeatSlideshow: !s.repeatSlideshow}))} className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors ${settings.repeatSlideshow ? 'bg-brand-purple' : 'bg-gray-600'}`}>
                                            <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${settings.repeatSlideshow ? 'translate-x-6' : 'translate-x-1'}`}/>
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <label htmlFor="showCaptions" className="text-sm font-medium text-gray-300">Show Captions</label>
                                        <button onClick={() => setSettings(s => ({...s, showCaptions: !s.showCaptions}))} className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors ${settings.showCaptions ? 'bg-brand-purple' : 'bg-gray-600'}`}>
                                            <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${settings.showCaptions ? 'translate-x-6' : 'translate-x-1'}`}/>
                                        </button>
                                    </div>
                                     <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                                        <label htmlFor="smartCaptions" className="text-sm font-medium text-gray-300">Enable Smart Captions (AI)</label>
                                        <button onClick={() => setSettings(s => ({...s, smartCaptionsEnabled: !s.smartCaptionsEnabled}))} className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors ${settings.smartCaptionsEnabled ? 'bg-brand-purple' : 'bg-gray-600'}`}>
                                            <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${settings.smartCaptionsEnabled ? 'translate-x-6' : 'translate-x-1'}`}/>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        {/* Preview and Manage Column */}
                        <div className="space-y-6">
                            <div className="bg-gray-800/50 p-6 rounded-lg">
                               <h3 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">4. Run Slideshow</h3>
                                <div className="aspect-video bg-black rounded-lg flex items-center justify-center relative overflow-hidden">
                                    {mediaFiles.length > 0 ? (
                                        <img src={mediaFiles[0].previewUrl} alt="Preview" className="w-full h-full object-contain" />
                                    ) : (
                                        <div className="text-gray-500 text-center">
                                            <FilmIcon className="w-24 h-24 mx-auto" />
                                            <p>Your slideshow will appear here</p>
                                        </div>
                                    )}
                                     <button onClick={handlePlay} className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed" disabled={mediaFiles.length === 0}>
                                        <PlayIcon className="w-20 h-20 text-white" />
                                    </button>
                                </div>
                            </div>
                            
                            {/* Save & Manage */}
                            <div className="bg-gray-800/50 p-6 rounded-lg">
                                <h3 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">5. Save, Share & Manage</h3>
                                <div className="flex gap-4 mb-4">
                                     <input type="text" value={slideshowName} onChange={(e) => setSlideshowName(e.target.value)} placeholder="Enter slideshow name" className="flex-grow bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-brand-purple focus:border-brand-purple block w-full p-2.5" />
                                     <button onClick={handleSaveSlideshow} disabled={isSaving || mediaFiles.length === 0} className="bg-brand-purple hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg flex items-center gap-2 transition-colors disabled:bg-gray-500">
                                        <SaveIcon className="w-5 h-5" />
                                        {currentSlideshowId ? 'Update' : 'Save'}
                                     </button>
                                     <button onClick={resetWorkspace} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition-colors">New</button>
                                </div>
                                
                                <h4 className="text-lg font-semibold mt-6 mb-2">My Slideshows</h4>
                                <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                                    {isLoading ? <p>Loading slideshows...</p> : allSlideshows.length > 0 ? allSlideshows.map(s => (
                                        <div key={s.id} className="flex justify-between items-center bg-gray-700/50 p-2 rounded-lg gap-2">
                                            <div className="flex items-center gap-3 min-w-0">
                                                 {s.userId !== user.uid && s.ownerInfo?.photoURL && (
                                                    <img src={s.ownerInfo.photoURL} alt={s.ownerInfo.displayName ?? 'Owner'} className="w-8 h-8 rounded-full flex-shrink-0" title={`Shared by ${s.ownerInfo.displayName}`} />
                                                 )}
                                                <div className="truncate">
                                                    <p className="truncate font-semibold">{s.name}</p>
                                                     {s.userId !== user.uid && s.ownerInfo?.displayName && (
                                                        <p className="text-xs text-gray-400 truncate">By {s.ownerInfo.displayName}</p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex gap-2 flex-shrink-0">
                                                <button onClick={() => handleLoadSlideshow(s)} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded-md text-sm">Load</button>
                                                {s.userId === user.uid && (
                                                    <>
                                                        <button onClick={() => handleOpenShareModal(s)} className="bg-green-600 hover:bg-green-700 text-white font-bold p-2 rounded-md" title="Share"><ShareIcon className="w-4 h-4"/></button>
                                                        <button onClick={() => handleDeleteSlideshow(s)} className="bg-red-600 hover:bg-red-700 text-white font-bold p-2 rounded-md" title="Delete"><TrashIcon className="w-4 h-4"/></button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    )) : <p className="text-gray-400">No saved slideshows yet.</p>}
                                </div>
                            </div>

                        </div>
                    </div>
                )}

                {error && (
                    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-red-500 text-white py-2 px-6 rounded-lg shadow-lg z-50 flex items-center gap-2 animate-fade-in">
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
                    
                    {mediaFiles[currentSlide] && (
                        <div className="w-full h-full relative">
                            {mediaFiles[currentSlide].type === 'image' && (
                                <>
                                    <img
                                        key={mediaFiles[currentSlide].id}
                                        src={mediaFiles[currentSlide].previewUrl}
                                        alt="Slideshow"
                                        className={`w-full h-full object-cover animate-${settings.slideStyle}`}
                                    />
                                    {settings.showCaptions && (mediaFiles[currentSlide] as ImageFile).caption && (
                                        <div className="absolute bottom-5 left-0 right-0 p-4 text-center">
                                            <p className="inline-block bg-black/50 text-white text-xl md:text-2xl font-semibold py-2 px-4 rounded-lg animate-fade-in">
                                                {(mediaFiles[currentSlide] as ImageFile).caption}
                                            </p>
                                        </div>
                                    )}
                                </>
                            )}
                            {mediaFiles[currentSlide].type === 'video' && (
                                <video
                                    ref={videoPreviewRef}
                                    key={mediaFiles[currentSlide].id}
                                    src={mediaFiles[currentSlide].previewUrl}
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
                           {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    )}
                </div>
            )}

             {/* Share Modal */}
            {isShareModalOpen && slideshowToShare && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center animate-fade-in p-4" role="dialog" aria-modal="true" aria-labelledby="share-modal-title">
                    <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 relative">
                        <button onClick={handleCloseShareModal} className="absolute top-4 right-4 text-gray-400 hover:text-white" aria-label="Close share menu">
                            <XIcon className="w-6 h-6" />
                        </button>
                        <h2 id="share-modal-title" className="text-xl font-bold text-brand-purple mb-4">Share "{slideshowToShare.name}"</h2>
                        <div className="space-y-4">
                            <div className="flex gap-2">
                                <input
                                    type="email"
                                    value={shareEmail}
                                    onChange={(e) => setShareEmail(e.target.value)}
                                    placeholder="Enter user's Google email"
                                    className="flex-grow bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-brand-purple focus:border-brand-purple block w-full p-2.5"
                                    aria-label="Email to share with"
                                />
                                <button onClick={handleAddShare} disabled={isSharing || !shareEmail} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg disabled:bg-gray-500 flex-shrink-0">
                                    {isSharing ? 'Adding...' : 'Add'}
                                </button>
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold mb-2">Shared with:</h3>
                                <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                                    {(slideshowToShare.sharedWith ?? []).length > 0 ? (
                                        slideshowToShare.sharedWith!.map(email => (
                                            <div key={email} className="flex justify-between items-center bg-gray-700/50 p-2 rounded">
                                                <span className="text-sm truncate">{email}</span>
                                                <button onClick={() => handleRemoveShare(email)} disabled={isSharing} className="text-red-400 hover:text-red-300 p-1 disabled:opacity-50" aria-label={`Remove ${email}`}>
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))
                                    ) : <p className="text-gray-400 text-sm italic">Not shared with anyone yet.</p>}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Help Modal */}
            {isHelpModalOpen && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center animate-fade-in p-4" role="dialog" aria-modal="true" aria-labelledby="help-modal-title">
                    <div className="bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-8 relative">
                        <button onClick={() => setIsHelpModalOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white" aria-label="Close help guide">
                            <XIcon className="w-6 h-6" />
                        </button>
                        <h2 id="help-modal-title" className="text-2xl font-bold text-brand-purple mb-4">How to Use Muziq Slides</h2>
                        <div className="space-y-4 text-gray-300">
                            <p>Welcome! Muziq Slides helps you create beautiful, animated slideshows with your favorite photos, videos, and music. It's perfect for creating a custom screensaver for your TV.</p>
                            <h3 className="text-xl font-semibold text-white pt-2 border-t border-gray-700">Quick Start Guide:</h3>
                            <ol className="list-decimal list-inside space-y-2">
                                <li><strong>Sign In:</strong> Click the "Sign in with Google" button to save and manage your creations.</li>
                                <li><strong>Upload Media:</strong> Click the upload box to select up to 20 of your favorite images and videos.</li>
                                <li><strong>Arrange Your Story:</strong> Simply drag and drop the thumbnails to reorder your media and perfect the flow of your slideshow.</li>
                                <li><strong>Add Captions:</strong> Type a description below each image. Or, enable "Smart Captions" in Settings and click the ✨ icon to generate one with AI!</li>
                                <li><strong>Add Music:</strong> Click the music box to add a background audio track to your slideshow.</li>
                                <li><strong>Customize:</strong> Use the Settings panel to choose slide styles and duration.</li>
                                <li><strong>Save & Share:</strong> Name your slideshow, hit "Save", and use the "Share" icon to invite friends.</li>
                                <li><strong>Preview:</strong> Hover over the preview window and click the play icon to see your slideshow in action.</li>
                            </ol>
                            <p>That's it! Enjoy your personalized slideshow.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;