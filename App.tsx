import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";

// --- TYPE DEFINITIONS ---
interface ImageFile {
  id: string;
  file: File;
  previewUrl: string;
  caption?: string;
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

// --- UI HELPER COMPONENTS ---
const ToggleSwitch: React.FC<{ enabled: boolean; onChange: (enabled: boolean) => void; label: string; }> = ({ enabled, onChange, label }) => (
    <div className="flex items-center">
        <label className="mr-3 font-medium text-gray-300 cursor-pointer" onClick={() => onChange(!enabled)}>{label}</label>
        <button
            onClick={() => onChange(!enabled)}
            className={`${enabled ? 'bg-purple-600' : 'bg-gray-600'} relative inline-flex items-center h-6 rounded-full w-11 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-purple-500`}
            aria-checked={enabled}
        >
            <span
                className={`${enabled ? 'translate-x-6' : 'translate-x-1'} inline-block w-4 h-4 transform bg-white rounded-full transition-transform`}
            />
        </button>
    </div>
);


// --- MAIN APPLICATION COMPONENT ---
export default function App() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [interval, setIntervalValue] = useState<number>(5);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [showPublishedModal, setShowPublishedModal] = useState<boolean>(false);
  const [slideStyle, setSlideStyle] = useState<string>('kenburns');
  const [showClock, setShowClock] = useState<boolean>(true);
  const [smartCaptionsEnabled, setSmartCaptionsEnabled] = useState<boolean>(false);
  const [captionStatus, setCaptionStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle');

  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const newImages = files.map((file: File) => ({
      id: `${file.name}-${Date.now()}`,
      file: file,
      previewUrl: URL.createObjectURL(file),
    }));
    
    setImages(prev => {
        const combined = [...prev, ...newImages];
        if(combined.length > 20) {
            alert("You can only upload a maximum of 20 images.");
            return prev.slice(0, 20);
        }
        return combined;
    });
  };
  
  const removeImage = (id: string) => {
    setImages(prev => prev.filter(image => {
        if (image.id === id) {
            URL.revokeObjectURL(image.previewUrl);
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

  const generateCaptions = useCallback(async () => {
    if (!smartCaptionsEnabled || captionStatus === 'generating') return;

    const imagesToCaption = images.filter(img => !img.caption);
    if (imagesToCaption.length === 0) {
        if(images.length > 0) setCaptionStatus('done');
        return;
    }

    setCaptionStatus('generating');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      // Use a mutable copy for updates within the loop
      const updatedImages = [...images];

      for (const imageFile of imagesToCaption) {
        const imagePart = await fileToGenerativePart(imageFile.file);
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [imagePart, { text: "Describe this image in a short, one-sentence caption for a photo slideshow." }] },
        });
        const caption = response.text;
        
        const index = updatedImages.findIndex(img => img.id === imageFile.id);
        if (index !== -1) {
            updatedImages[index] = { ...updatedImages[index], caption: caption.trim() };
        }
      }
      setImages(updatedImages);
      setCaptionStatus('done');
    } catch (error) {
      console.error("Error generating captions:", error);
      setCaptionStatus('error');
    }
  }, [images, smartCaptionsEnabled, captionStatus]);

  useEffect(() => {
    if (smartCaptionsEnabled && captionStatus !== 'done') {
      generateCaptions();
    }
    if (images.length === 0) {
        setCaptionStatus('idle');
    }
  }, [smartCaptionsEnabled, images, generateCaptions, captionStatus]);


  const isReadyToPlay = images.length > 0 && audioFile;
  const isWorking = captionStatus === 'generating';

  useEffect(() => {
    return () => {
      images.forEach(image => URL.revokeObjectURL(image.previewUrl));
    };
  }, [images]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-600">
            Muziq Slides
          </h1>
          <p className="mt-2 text-lg text-gray-400">Create your personal photo and music screensaver.</p>
        </header>

        <main className="space-y-12">
          {/* Step 1: Image Upload */}
          <section className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 shadow-lg">
            <h2 className="text-2xl font-semibold mb-4 border-b border-gray-600 pb-2">1. Upload Your Images (up to 20)</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-4">
              {images.map(image => (
                <div key={image.id} className="relative group aspect-square">
                  <img src={image.previewUrl} alt={image.file.name} className="w-full h-full object-cover rounded-md shadow-md"/>
                  <button onClick={() => removeImage(image.id)} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <XIcon className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {images.length < 20 && (
                <button onClick={() => imageInputRef.current?.click()} className="flex items-center justify-center aspect-square border-2 border-dashed border-gray-500 rounded-md hover:bg-gray-700 hover:border-purple-500 transition-colors">
                  <UploadIcon className="w-8 h-8 text-gray-400" />
                </button>
              )}
            </div>
            <input type="file" ref={imageInputRef} onChange={handleImageUpload} accept="image/*" multiple className="hidden"/>
            <p className="text-sm text-gray-400">{images.length} / 20 images uploaded.</p>
          </section>

          {/* Step 2: Audio Upload */}
          <section className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 shadow-lg">
            <h2 className="text-2xl font-semibold mb-4 border-b border-gray-600 pb-2">2. Add Your Music</h2>
            <div className="flex items-center space-x-4">
              <button onClick={() => audioInputRef.current?.click()} className="flex-shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-md transition-colors flex items-center space-x-2">
                <MusicIcon className="w-5 h-5"/>
                <span>{audioFile ? "Change Song" : "Select Song"}</span>
              </button>
              {audioFile && <p className="text-gray-300 truncate">{audioFile.name}</p>}
            </div>
            <input type="file" ref={audioInputRef} onChange={handleAudioUpload} accept="audio/*" className="hidden"/>
          </section>

          {/* Step 3: Settings */}
          <section className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 shadow-lg">
            <h2 className="text-2xl font-semibold mb-4 border-b border-gray-600 pb-2">3. Configure Slideshow</h2>
            <div className="space-y-6">
                <div>
                    <label className="block mb-2 font-medium text-gray-300">Slide Speed (seconds)</label>
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
                            <ToggleSwitch enabled={smartCaptionsEnabled} onChange={setSmartCaptionsEnabled} label="Smart Captions" />
                            {captionStatus === 'generating' && <div className="w-5 h-5 border-2 border-dashed rounded-full animate-spin border-purple-400"></div>}
                            {captionStatus === 'error' && <p className="text-sm text-red-400">Error.</p>}
                        </div>
                    </div>
                </div>
            </div>
          </section>
          
          {/* Step 4: Preview & Publish */}
          <section className="text-center py-6">
            <div className="flex justify-center items-center flex-wrap gap-4">
                <button onClick={() => setIsPlaying(true)} disabled={!isReadyToPlay || isWorking} className="flex items-center space-x-2 text-lg font-bold bg-green-600 hover:bg-green-500 text-white py-3 px-8 rounded-lg transition-all disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 shadow-lg">
                  <PlayIcon className="w-6 h-6"/>
                  <span>Preview Slideshow</span>
                </button>
                <button onClick={() => setIsPlaying(true)} disabled={!isReadyToPlay || isWorking} className="flex items-center space-x-2 text-lg font-bold bg-purple-600 hover:bg-purple-500 text-white py-3 px-8 rounded-lg transition-all disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 shadow-lg">
                  <PlayIcon className="w-6 h-6"/>
                  <span>Play Slideshow</span>
                </button>
                <button onClick={() => setShowPublishedModal(true)} disabled={!isReadyToPlay || isWorking} className="text-lg font-bold bg-blue-600 hover:bg-blue-500 text-white py-3 px-8 rounded-lg transition-all disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 shadow-lg">
                  Publish
                </button>
            </div>
            {!isReadyToPlay && <p className="mt-4 text-yellow-400">Please upload at least one image and one audio file to proceed.</p>}
            {isWorking && <p className="mt-4 text-purple-400">Generating smart captions, please wait...</p>}
          </section>
        </main>
      </div>

      {isPlaying && isReadyToPlay && (
        <SlideshowPlayer 
          images={images}
          audioFile={audioFile}
          interval={interval}
          onClose={() => setIsPlaying(false)}
          slideStyle={slideStyle}
          showClock={showClock}
          smartCaptionsEnabled={smartCaptionsEnabled}
        />
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
    images: ImageFile[];
    audioFile: File;
    interval: number;
    onClose: () => void;
    slideStyle: string;
    showClock: boolean;
    smartCaptionsEnabled: boolean;
}

const SlideshowPlayer: React.FC<SlideshowPlayerProps> = ({ images, audioFile, interval, onClose, slideStyle, showClock, smartCaptionsEnabled }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const audioRef = useRef<HTMLAudioElement>(null);
    const fadeOutIntervalRef = useRef<number | null>(null);

    const audioUrl = useMemo(() => URL.createObjectURL(audioFile), [audioFile]);

    const cleanup = useCallback(() => {
        URL.revokeObjectURL(audioUrl);
        if (fadeOutIntervalRef.current) {
            clearInterval(fadeOutIntervalRef.current);
        }
    }, [audioUrl]);

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
    
    // Timer to advance the slide
    useEffect(() => {
        if (images.length < 2) return; // No need for a timer if there's only one image
        const slideTimer = setInterval(() => {
            setCurrentIndex(prev => (prev + 1) % images.length);
        }, interval * 1000);

        return () => clearInterval(slideTimer);
    }, [images.length, interval]);

    // Audio control for fade-out and looping
    useEffect(() => {
        const audioEl = audioRef.current;
        if (!audioEl) return;

        // Clear any ongoing fadeout when the slide changes
        if (fadeOutIntervalRef.current) {
            clearInterval(fadeOutIntervalRef.current);
            fadeOutIntervalRef.current = null;
        }

        // When slideshow loops to the first image, reset audio
        if (currentIndex === 0) {
            audioEl.volume = 1.0;
            audioEl.currentTime = 0;
            audioEl.play().catch(error => console.warn("Audio playback failed:", error));
        }

        // When the last image is displayed, start fading out the audio
        if (currentIndex === images.length - 1 && images.length > 1) {
            const fadeDurationMs = interval * 1000;
            if (fadeDurationMs <= 0) return;

            const tickIntervalMs = 50; // How often to update the volume
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
    }, [currentIndex, images.length, interval]);
    
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
                {images.map((image, index) => (
                    <div key={image.id} className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${index === currentIndex ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}>
                         {/* Only render the image for the active slide. This ensures the animation class is freshly applied on mount. */}
                         {index === currentIndex && (
                             <img 
                                src={image.previewUrl} 
                                alt={`Slideshow image ${index + 1}`} 
                                className={`w-full h-full object-contain ${getAnimationClass(slideStyle)}`} 
                              />
                         )}
                        {smartCaptionsEnabled && image.caption && index === currentIndex && (
                            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/70 to-transparent z-20 animate-fade-in">
                                <p className="text-center text-white text-xl sm:text-2xl drop-shadow-lg">
                                    {image.caption}
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