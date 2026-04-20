/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  Plus, 
  Trash2,
  Edit2,
  Check,
  X,
  Camera, 
  Info, 
  BarChart2, 
  Database,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  LogIn,
  LogOut,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area,
  Legend
} from 'recharts';
import { GoogleGenAI } from "@google/genai";
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  deleteDoc,
  doc,
  updateDoc
} from 'firebase/firestore';

// --- Types ---
interface Experiment {
  id?: string;
  userId: string;
  name: string;
  distance: number;
  displacement: number;
  time: number;
  speed: number;
  velocity: number;
  acceleration: number;
  retardation: number;
  derivedFields?: string[];
  createdAt?: any;
}

interface StatDetails {
  mean: number;
  median: number;
  stdev: number;
  variance: number;
  min: number;
  max: number;
  sum: number;
}

interface ComputedStats {
  [key: string]: StatDetails | null;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [stats, setStats] = useState<ComputedStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'table' | 'charts' | 'cv'>('table');
  const [isCapturing, setIsCapturing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const floatingVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Re-attach stream whenever video elements might mount/unmount
  useEffect(() => {
    if (isCapturing && cameraStreamRef.current) {
      if (videoRef.current && videoRef.current.srcObject !== cameraStreamRef.current) {
        videoRef.current.srcObject = cameraStreamRef.current;
      }
      if (floatingVideoRef.current && floatingVideoRef.current.srcObject !== cameraStreamRef.current) {
        floatingVideoRef.current.srcObject = cameraStreamRef.current;
      }
    }
  }, [isCapturing, activeTab]);

  // New Experiment Form State
  const [newExp, setNewExp] = useState<Partial<Experiment>>({
    name: 'Experiment',
    distance: 0,
    displacement: 0,
    time: 1,
    speed: 0,
    velocity: 0,
    acceleration: 0,
    retardation: 0
  });

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (!u) {
        setExperiments([]);
        setStats(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Data Listener (Firestore)
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'measurements'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Experiment[];
      setExperiments(data);
      computeStats(data);
    });

    return () => unsubscribe();
  }, [user]);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login failed:", err);
    }
  };

  const logout = () => signOut(auth);

  const computeStats = async (data: Experiment[]) => {
    if (data.length === 0) return;
    try {
      const res = await fetch('/api/compute-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const statsData = await res.json();
      setStats(statsData);
    } catch (error) {
      console.error('Error computing stats:', error);
    }
  };

  const handleAddExperiment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const sanitize = (val: any) => (isNaN(val) || val === undefined || val === null) ? 0 : val;

    let distance = sanitize(newExp.distance);
    let displacement = sanitize(newExp.displacement);
    let time = sanitize(newExp.time);
    let speed = sanitize(newExp.speed);
    let velocity = sanitize(newExp.velocity);
    let acceleration = sanitize(newExp.acceleration);
    let retardation = sanitize(newExp.retardation);

    const derived: string[] = [];
    
    // Logic: Solve for the third if two are present in (d, v, t)
    // 1. Distance / Speed / Time
    if (!distance && speed && time) {
      distance = speed * time;
      derived.push('distance');
    } else if (distance && !speed && time && time !== 0) {
      speed = distance / time;
      derived.push('speed');
    } else if (distance && speed && !time && speed !== 0) {
      time = distance / speed;
      derived.push('time');
    }

    // 2. Displacement / Velocity / Time
    if (!displacement && velocity && time) {
      displacement = velocity * time;
      derived.push('displacement');
    } else if (displacement && !velocity && time && time !== 0) {
      velocity = displacement / time;
      derived.push('velocity');
    } else if (displacement && velocity && (!time || !derived.includes('time')) && velocity !== 0) {
       if (!time) {
         time = displacement / velocity;
         derived.push('time');
       }
    }

    // 3. Acceleration / Velocity / Time (assuming v_i = 0 for simple lab)
    if (!acceleration && velocity && time && time !== 0) {
      acceleration = velocity / time;
      derived.push('acceleration');
    } else if (acceleration && time && !velocity) {
      velocity = acceleration * time;
      derived.push('velocity');
    }

    // 4. Retardation (inverse of negative acceleration)
    if (!retardation && acceleration < 0) {
      retardation = Math.abs(acceleration);
      derived.push('retardation');
    }

    const payload = { 
      userId: user.uid,
      name: newExp.name || 'Experiment',
      distance: Number(distance) || 0,
      displacement: Number(displacement) || 0,
      time: Number(time) || 1,
      speed: Number(speed) || 0,
      velocity: Number(velocity) || 0,
      acceleration: Number(acceleration) || 0,
      retardation: Number(retardation) || 0,
      derivedFields: derived,
      createdAt: serverTimestamp()
    };
    
    try {
      await addDoc(collection(db, 'measurements'), payload);
      setNewExp({
        name: 'Experiment',
        distance: 0,
        displacement: 0,
        time: 0,
        speed: 0,
        velocity: 0,
        acceleration: 0,
        retardation: 0
      });
    } catch (error) {
      console.error('Error adding experiment:', error);
    }
  };

  const deleteExperiment = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'measurements', id));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const startRename = (id: string, currentName: string) => {
    setEditingId(id);
    setEditingName(currentName);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingName('');
  };

  const saveRename = async (id: string) => {
    if (!editingName.trim()) return;
    try {
      await updateDoc(doc(db, 'measurements', id), {
        name: editingName.trim()
      });
      setEditingId(null);
      setEditingName('');
    } catch (err) {
      console.error("Rename failed:", err);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      if (floatingVideoRef.current) {
        floatingVideoRef.current.srcObject = stream;
      }
      setIsCapturing(true);
    } catch (err) {
      console.error("Camera error:", err);
      alert("Please ensure you have granted camera permissions.");
    }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop());
      cameraStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (floatingVideoRef.current) {
      floatingVideoRef.current.srcObject = null;
    }
    setIsCapturing(false);
  };

  const captureAndAnalyze = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    setLoading(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    ctx.drawImage(videoRef.current, 0, 0);
    
    const base64Image = canvas.toDataURL('image/jpeg').split(',')[1];
    
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          },
          {
            text: `PRECISION KINEMATICS ANALYSIS:
Analyze this laboratory scene for physical motion benchmarks.
Identify the primary object in motion and estimate its parameters relative to the scene (use object known sizes for scale if available).
Parameters to derive:
1. Scalar Distance (m)
2. Directional Displacement (m)
3. Event Duration (s)
4. Linear Speed (m/s)
5. Vector Velocity (m/s, magnitude only)
6. Acceleration magnitude (m/s²)
7. Retardation (negative acceleration magnitude if slowing down).

Calculations MUST be physically consistent (v = d/t). 
If specific data points are missing, extrapolate from visual motion blur or object position.

Return ONLY a JSON object:
{
  "distance": number,
  "displacement": number,
  "time": number,
  "speed": number,
  "velocity": number,
  "acceleration": number,
  "retardation": number,
  "analysisLabel": string (short description of what was tracked)
}`,
          },
        ],
        config: {
          responseMimeType: "application/json",
        }
      });
      
      const analysis = JSON.parse(response.text || '{}');
      setNewExp({
        ...newExp,
        name: analysis.analysisLabel || 'CV Tracker Record',
        distance: analysis.distance || 0,
        displacement: analysis.displacement || 0,
        time: analysis.time || 0,
        speed: analysis.speed || 0,
        velocity: analysis.velocity || 0,
        acceleration: analysis.acceleration || 0,
        retardation: analysis.retardation || 0,
      });
      setActiveTab('table');
      stopCamera();
    } catch (err) {
      console.error("Analysis error:", err);
    } finally {
      setLoading(false);
    }
  };

  const activeExperiments = [...experiments].reverse();
  const safeChartData = activeExperiments.map(e => ({
    ...e,
    speed: isNaN(e.speed) ? 0 : e.speed,
    velocity: isNaN(e.velocity) ? 0 : e.velocity,
    time: isNaN(e.time) ? 0 : e.time,
    distance: isNaN(e.distance) ? 0 : e.distance
  }));

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F3]">
        <RefreshCw size={32} className="animate-spin text-[#FF6B35]" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F5F5F3] flex flex-col items-center justify-center p-6 text-center">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-12 rounded-3xl border border-[#D1D1CB] shadow-2xl max-w-md w-full"
        >
          <div className="w-20 h-20 bg-[#FF6B35] rounded-full flex items-center justify-center text-white mx-auto mb-8 shadow-xl shadow-[#FF6B35]/20">
            <Activity size={40} />
          </div>
          <h1 className="text-3xl font-black uppercase tracking-tight mb-4">Kinematics Lab</h1>
          <p className="text-[#8E8E8A] mb-8 leading-relaxed font-medium">Secure research unit for scientific data logging, computer vision analysis, and statistical processing.</p>
          <button 
            onClick={login}
            className="w-full bg-[#1A1A1A] text-white py-5 rounded-2xl font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-3 hover:bg-[#FF6B35] transition-all group"
          >
            Sign in with Research ID <LogIn size={18} className="group-hover:translate-x-1 transition-transform" />
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F3] text-[#1A1A1A] font-sans selection:bg-[#FF6B35] selection:text-white pb-20">
      {/* Floating Camera Overlay */}
      <AnimatePresence>
        {isCapturing && activeTab !== 'cv' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 50 }}
            className="fixed bottom-8 right-8 w-64 aspect-video bg-black rounded-2xl border-4 border-[#1A1A1A] shadow-2xl z-[100] overflow-hidden group cursor-pointer"
            onClick={() => setActiveTab('cv')}
          >
            <video 
              ref={floatingVideoRef} 
              autoPlay 
              playsInline 
              muted
              className="w-full h-full object-cover"
            />
            {/* Tracking Overlay (Mini) */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute left-0 right-0 h-0.5 bg-orange-500/50 shadow-[0_0_15px_rgba(255,107,53,0.8)] animate-scan" />
              <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/50 backdrop-blur-md px-1.5 py-0.5 rounded border border-white/10">
                <div className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[7px] text-white font-bold uppercase tracking-widest">Live Tracker</span>
              </div>
            </div>
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
               <span className="text-[8px] text-white font-bold uppercase tracking-widest bg-black/60 px-3 py-1 rounded-full border border-white/20">Expand View</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="border-b border-[#D1D1CB] bg-white sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-[#FF6B35] rounded-full flex items-center justify-center text-white shadow-lg shadow-[#FF6B35]/20">
              <Activity size={24} />
            </div>
            <div>
              <h1 className="font-bold text-xl leading-tight uppercase tracking-tight">Kinematics <span className="text-[#FF6B35]">Lab</span></h1>
              <p className="text-[10px] uppercase tracking-widest text-[#8E8E8A] font-bold">Authenticated Scientific Session</p>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <nav className="flex gap-1 bg-[#F0F0EE] p-1 rounded-xl hidden md:flex">
              {[
                { id: 'table', icon: Database, label: 'Data' },
                { id: 'charts', icon: BarChart2, label: 'Charts' },
                { id: 'cv', icon: Camera, label: 'CV Tracker' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-6 py-3 rounded-lg transition-all text-xs font-bold uppercase tracking-wide ${
                    activeTab === tab.id 
                      ? 'bg-white text-[#FF6B35] shadow-sm' 
                      : 'text-[#8E8E8A] hover:text-[#5A5A57]'
                  }`}
                >
                  <tab.icon size={14} />
                  {tab.label}
                </button>
              ))}
            </nav>

            <div className="h-10 w-[1px] bg-[#D1D1CB] hidden md:block" />

            <div className="flex items-center gap-3 bg-[#F5F5F3] px-3 py-1.5 rounded-full border border-[#D1D1CB]">
              <div className="w-7 h-7 rounded-full bg-[#1A1A1A] flex items-center justify-center text-white overflow-hidden">
                {user.photoURL ? <img src={user.photoURL} alt="User" referrerPolicy="no-referrer" /> : <UserIcon size={14} />}
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider hidden lg:inline">{user.displayName?.split(' ')[0]}</span>
              <button 
                onClick={logout}
                className="text-[#8E8E8A] hover:text-red-500 transition-colors"
                title="Log Out"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Form & Stats Summary */}
          <div className="lg:col-span-4 space-y-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white p-6 rounded-2xl border border-[#D1D1CB] shadow-sm"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-bold uppercase tracking-tight text-sm">Add New Record</h2>
                <div className="text-[10px] px-2 py-1 bg-[#F5F5F3] rounded text-[#8E8E8A] font-mono">ID: {experiments.length + 1}</div>
              </div>
              
              <form onSubmit={handleAddExperiment} className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-bold text-[#8E8E8A] block mb-1">Experiment Name</label>
                  <input 
                    type="text"
                    value={newExp.name}
                    onChange={e => setNewExp({...newExp, name: e.target.value})}
                    className="w-full bg-[#F9F9F7] border border-[#EBEBE8] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#FF6B35] transition-colors"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-[#8E8E8A] block mb-1">Distance (m)</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={newExp.distance || ''}
                      onChange={e => setNewExp({...newExp, distance: isNaN(parseFloat(e.target.value)) ? 0 : parseFloat(e.target.value)})}
                      className="w-full bg-[#F9F9F7] border border-[#EBEBE8] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#FF6B35]"
                      placeholder="Auto"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-[#8E8E8A] block mb-1">Speed (m/s)</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={newExp.speed || ''}
                      onChange={e => setNewExp({...newExp, speed: isNaN(parseFloat(e.target.value)) ? 0 : parseFloat(e.target.value)})}
                      className="w-full bg-[#F9F9F7] border border-[#EBEBE8] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#FF6B35]"
                      placeholder="Auto"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-[#8E8E8A] block mb-1">Displacement (m)</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={newExp.displacement || ''}
                      onChange={e => setNewExp({...newExp, displacement: isNaN(parseFloat(e.target.value)) ? 0 : parseFloat(e.target.value)})}
                      className="w-full bg-[#F9F9F7] border border-[#EBEBE8] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#FF6B35]"
                      placeholder="Auto"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-[#8E8E8A] block mb-1">Velocity (m/s)</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={newExp.velocity || ''}
                      onChange={e => setNewExp({...newExp, velocity: isNaN(parseFloat(e.target.value)) ? 0 : parseFloat(e.target.value)})}
                      className="w-full bg-[#F9F9F7] border border-[#EBEBE8] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#FF6B35]"
                      placeholder="Auto"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-[#8E8E8A] block mb-1">Time Elapsed (s)</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={newExp.time}
                      onChange={e => setNewExp({...newExp, time: isNaN(parseFloat(e.target.value)) ? 0 : parseFloat(e.target.value)})}
                      className="w-full bg-[#F9F9F7] border border-[#EBEBE8] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#FF6B35]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-[#8E8E8A] block mb-1">Acceleration (m/s²)</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={newExp.acceleration}
                      onChange={e => setNewExp({...newExp, acceleration: isNaN(parseFloat(e.target.value)) ? 0 : parseFloat(e.target.value)})}
                      className="w-full bg-[#F9F9F7] border border-[#EBEBE8] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#FF6B35]"
                    />
                  </div>
                </div>

                <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 mb-2">
                  <div className="flex items-start gap-2">
                    <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-[9px] text-blue-700 leading-tight">
                      <strong>Auto-Calc Active</strong>: Leave speed/distance blank; if related parameters exist, the system will derive missing values automatically on save.
                    </p>
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full bg-[#1A1A1A] text-white rounded-xl py-4 font-bold uppercase tracking-widest text-xs hover:bg-[#FF6B35] transition-all flex items-center justify-center gap-2 group shadow-lg shadow-black/5"
                >
                  Save Data <Plus size={16} className="group-hover:rotate-90 transition-transform" />
                </button>
              </form>
            </motion.div>

            {/* Python Stats Engine Output */}
            {stats && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-black text-white p-6 rounded-2xl shadow-xl overflow-hidden relative"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#FF6B35]/20 blur-3xl -mr-10 -mt-10" />
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="font-bold uppercase tracking-tight text-sm text-[#FF6B35]">Python Stats Engine</h2>
                    <RefreshCw 
                      size={14} 
                      className={`text-[#8E8E8A] cursor-pointer hover:text-white transition-colors ${loading ? 'animate-spin' : ''}`} 
                    />
                  </div>
                  
                  <div className="space-y-4">
                    {['speed', 'velocity', 'acceleration'].map((metric) => (
                      <div key={metric} className="border-b border-white/10 pb-4 last:border-0 last:pb-0">
                        <div className="flex justify-between items-end mb-2">
                          <p className="text-[10px] uppercase font-bold text-[#8E8E8A]">{metric} avg</p>
                          <p className="text-xl font-mono leading-none text-white">
                            {stats && stats[metric] ? stats[metric]!.mean.toFixed(2) : '0.00'} 
                            <span className="text-xs text-[#8E8E8A]"> {metric === 'acceleration' ? 'm/s²' : 'm/s'}</span>
                          </p>
                        </div>
                      </div>
                    ))}

                    {experiments.some(e => e.derivedFields && e.derivedFields.length > 0) && (
                      <div className="pt-2">
                        <div className="flex items-center gap-2 text-yellow-500 uppercase font-bold text-[8px] animate-pulse">
                          <AlertCircle size={10} /> Mixed Data Model (Derived + Raw)
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="mt-6 p-3 bg-white/5 rounded-lg border border-white/10">
                    <div className="flex items-start gap-2">
                      <Info size={14} className="text-[#FF6B35] shrink-0 mt-0.5" />
                      <p className="text-[10px] text-[#8E8E8A] leading-relaxed">
                        Data verified using Python's <code className="text-white">statistics</code> and <code className="text-white">math</code> libraries for high precision scientific reporting.
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          {/* Right Column: Dynamic Content */}
          <div className="lg:col-span-8">
            <AnimatePresence mode="wait">
              {activeTab === 'table' && (
                <motion.div
                  key="table"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-2xl border border-[#D1D1CB] shadow-sm overflow-hidden"
                >
                  <div className="p-6 border-b border-[#F0F0EE] flex items-center justify-between">
                    <div>
                      <h2 className="font-bold uppercase tracking-tight text-sm">Experiment Records</h2>
                      <p className="text-[10px] text-[#8E8E8A] uppercase font-semibold">Scientific Log View</p>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-[#8E8E8A] bg-[#F5F5F3] px-3 py-1 rounded-full uppercase">
                        <Database size={10} /> {experiments.length} Records
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#F9F9F7] border-b border-[#F0F0EE]">
                          <th className="px-6 py-4 text-[10px] uppercase font-bold text-[#8E8E8A] tracking-wider italic font-serif">Experiment</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-bold text-[#8E8E8A] tracking-wider italic font-serif text-center">T (s)</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-bold text-[#8E8E8A] tracking-wider italic font-serif text-center">Sp (m/s)</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-bold text-[#8E8E8A] tracking-wider italic font-serif text-center">Vel (m/s)</th>
                          <th className="px-6 py-4 text-[10px] uppercase font-bold text-[#8E8E8A] tracking-wider italic font-serif text-center">Acc (m/s²)</th>
                          <th className="px-6 py-4 text-right"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F0F0EE]">
                        {experiments.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-6 py-12 text-center text-[#8E8E8A]">
                              <div className="flex flex-col items-center gap-2">
                                <DATABASE_ICON size={32} className="opacity-20" />
                                <p className="text-xs font-bold uppercase tracking-widest">Scientific log is empty</p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          experiments.map((exp) => (
                            <tr key={exp.id} className="hover:bg-[#FFF8F5] transition-colors group">
                              <td className="px-6 py-4">
                                {editingId === exp.id ? (
                                  <div className="flex items-center gap-2">
                                    <input 
                                      type="text"
                                      value={editingName}
                                      onChange={e => setEditingName(e.target.value)}
                                      className="bg-[#F9F9F7] border border-[#FF6B35] rounded px-2 py-1 text-sm font-bold w-full focus:outline-none"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') saveRename(exp.id!);
                                        if (e.key === 'Escape') cancelRename();
                                      }}
                                    />
                                    <button 
                                      onClick={() => saveRename(exp.id!)}
                                      className="text-green-600 hover:text-green-700 transition-colors"
                                    >
                                      <Check size={16} />
                                    </button>
                                    <button 
                                      onClick={cancelRename}
                                      className="text-red-400 hover:text-red-500 transition-colors"
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 group/name">
                                    <p className="text-sm font-bold">{exp.name}</p>
                                    <button 
                                      onClick={() => startRename(exp.id!, exp.name)}
                                      className="text-[#8E8E8A] hover:text-[#FF6B35] transition-all opacity-0 group-hover/name:opacity-100"
                                    >
                                      <Edit2 size={12} />
                                    </button>
                                  </div>
                                )}
                                <p className="text-[10px] text-[#8E8E8A] font-mono">{exp.createdAt?.toDate ? exp.createdAt.toDate().toLocaleTimeString() : 'Recently'}</p>
                                {exp.derivedFields && exp.derivedFields.length > 0 && (
                                  <div className="flex gap-1 mt-1 flex-wrap">
                                    {exp.derivedFields.map(f => (
                                      <span key={f} className="text-[8px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded uppercase font-bold">Calculated {f}</span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-6 py-4 text-sm font-mono text-center">{exp.time.toFixed(2)}</td>
                              <td className="px-6 py-4 text-sm font-mono text-center font-bold text-[#FF6B35]">{exp.speed.toFixed(2)}</td>
                              <td className="px-6 py-4 text-sm font-mono text-center">{exp.velocity.toFixed(2)}</td>
                              <td className="px-6 py-4 text-sm font-mono text-center">{exp.acceleration.toFixed(2)}</td>
                              <td className="px-6 py-4 text-right">
                                <button 
                                  onClick={() => deleteExperiment(exp.id!)}
                                  className="p-2 text-[#8E8E8A] hover:text-red-500 hover:bg-red-50 transition-all rounded-lg opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}

              {activeTab === 'charts' && (
                <motion.div
                  key="charts"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-6"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Speed vs Time Graph */}
                    <div className="bg-white p-6 rounded-2xl border border-[#D1D1CB] shadow-sm">
                      <h2 className="font-bold uppercase tracking-tight text-sm mb-6">Speed-Time Chart</h2>
                      <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={safeChartData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0F0EE" />
                            <XAxis dataKey="time" label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, fontSize: 10 }} fontSize={10} />
                            <YAxis fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#8E8E8A'}} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#1A1A1A', border: 'none', borderRadius: '12px', color: '#fff' }}
                            />
                            <Line type="monotone" dataKey="speed" stroke="#FF6B35" strokeWidth={3} dot={{ r: 4, fill: '#FF6B35', stroke: '#fff', strokeWidth: 2 }} animationDuration={1000} />
                            <Legend wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold' }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Velocity vs Time Graph */}
                    <div className="bg-white p-6 rounded-2xl border border-[#D1D1CB] shadow-sm">
                      <h2 className="font-bold uppercase tracking-tight text-sm mb-6">Velocity-Time Chart</h2>
                      <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={safeChartData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0F0EE" />
                            <XAxis dataKey="time" label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, fontSize: 10 }} fontSize={10} />
                            <YAxis fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#8E8E8A'}} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#1A1A1A', border: 'none', borderRadius: '12px', color: '#fff' }}
                            />
                            <Line type="monotone" dataKey="velocity" stroke="#1A1A1A" strokeWidth={3} dot={{ r: 4, fill: '#1A1A1A', stroke: '#fff', strokeWidth: 2 }} animationDuration={1000} />
                            <Legend wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold' }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-[#D1D1CB] shadow-sm">
                    <h2 className="font-bold uppercase tracking-tight text-sm mb-6">Distance vs Time (Kinetics)</h2>
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={safeChartData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0F0EE" />
                          <XAxis dataKey="time" label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                          <YAxis label={{ value: 'Distance (m)', angle: -90, position: 'insideLeft', fontSize: 10 }} fontSize={10} axisLine={false} tickLine={false} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1A1A1A', border: 'none', borderRadius: '8px', color: '#fff' }}
                          />
                          <Line type="monotone" dataKey="distance" stroke="#FF6B35" strokeWidth={3} dot={{ r: 6, fill: '#FF6B35', stroke: '#fff', strokeWidth: 2 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'cv' && (
                <motion.div
                  key="cv"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-2xl border border-[#D1D1CB] shadow-sm overflow-hidden"
                >
                  <div className="p-6 border-b border-[#F0F0EE]">
                    <h2 className="font-bold uppercase tracking-tight text-sm">AI Motion Tracker (CV)</h2>
                    <p className="text-[10px] text-[#8E8E8A] uppercase font-semibold">Computer Vision Analysis Unit</p>
                  </div>

                  <div className="p-8">
                    {!isCapturing ? (
                      <div className="bg-[#F5F5F3] border-2 border-dashed border-[#D1D1CB] rounded-2xl aspect-video flex flex-col items-center justify-center gap-4 transition-all hover:border-[#FF6B35] group">
                        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
                          <Camera size={24} className="text-[#FF6B35]" />
                        </div>
                        <div className="text-center">
                          <h3 className="font-bold text-sm uppercase">Initialize CV Camera</h3>
                          <p className="text-[10px] text-[#8E8E8A] max-w-[200px] mt-1">Allow Gemini to analyze the scene for kinematics extraction.</p>
                        </div>
                        <button 
                          onClick={startCamera}
                          className="mt-2 bg-[#1A1A1A] text-white px-6 py-3 rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-[#FF6B35] transition-all"
                        >
                          Start Live Tracker
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border-4 border-[#1A1A1A]">
                          <video 
                            ref={videoRef} 
                            autoPlay 
                            playsInline 
                            className="w-full h-full object-cover"
                          />
                          
                          {/* Tracker Overlay */}
                          <div className="absolute inset-0 pointer-events-none">
                            {/* Scanning Line */}
                            <div className="absolute left-0 right-0 h-0.5 bg-orange-500/50 shadow-[0_0_15px_rgba(255,107,53,0.8)] animate-scan z-10" />
                            
                            {/* Corner Targets */}
                            <div className="absolute top-8 left-8 w-12 h-12 border-t-2 border-l-2 border-orange-500/80 rounded-tl-lg" />
                            <div className="absolute top-8 right-8 w-12 h-12 border-t-2 border-r-2 border-orange-500/80 rounded-tr-lg" />
                            <div className="absolute bottom-8 left-8 w-12 h-12 border-b-2 border-l-2 border-orange-500/80 rounded-bl-lg" />
                            <div className="absolute bottom-8 right-8 w-12 h-12 border-b-2 border-r-2 border-orange-500/80 rounded-br-lg" />
                            
                            {/* Center Crosshair */}
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center">
                              <div className="w-full h-[1px] bg-white/30" />
                              <div className="absolute h-full w-[1px] bg-white/30" />
                              <div className="w-2 h-2 rounded-full border border-orange-500/50 animate-pulse-ring" />
                            </div>

                            {/* Telemetry Display */}
                            <div className="absolute bottom-4 right-4 bg-black/60 backdrop-blur-md px-3 py-2 rounded-lg border border-white/10 space-y-1">
                              <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                                <span className="text-[8px] text-white font-mono uppercase tracking-widest">Tracking Active</span>
                              </div>
                              <div className="text-[7px] text-orange-200/50 font-mono">FR: 60FPS | RES: HD</div>
                            </div>

                            <div className="absolute top-4 left-4 flex gap-2">
                              <div className="bg-red-500 w-2 h-2 rounded-full animate-pulse" />
                              <span className="text-[10px] text-white font-bold uppercase tracking-widest bg-black/50 px-2 py-0.5 rounded backdrop-blur-md">Live Scientific Stream</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-start gap-4 p-4 bg-[#F5F5F3] rounded-xl border border-[#D1D1CB]">
                          <div className="space-y-3">
                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]">Precision Tracking Requirements:</h4>
                            <ul className="text-[9px] text-[#5A5A57] space-y-1.5 list-disc pl-4">
                              <li><strong>Scale Reference:</strong> Ensure a known object (e.g., scale rule, standardized ball) is in the frame.</li>
                              <li><strong>Motion Plane:</strong> Objects should move perpendicular to the camera lens for accurate distance mapping.</li>
                              <li><strong>Lighting:</strong> High-contrast environments improve motion blur analysis for speed derivation.</li>
                              <li><strong>Static Background:</strong> A cluttered background may increase estimation error in CV extraction.</li>
                            </ul>
                          </div>
                        </div>
                        
                        <div className="flex gap-4">
                          <button 
                            onClick={captureAndAnalyze}
                            disabled={loading}
                            className="flex-1 bg-[#FF6B35] text-white rounded-xl py-4 font-bold uppercase tracking-widest text-xs hover:bg-[#E85D2A] disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#FF6B35]/20"
                          >
                            {loading ? <RefreshCw size={16} className="animate-spin" /> : <><Activity size={16} /> Analyze Motion Frame</>}
                          </button>
                          <button 
                            onClick={stopCamera}
                            className="bg-[#1A1A1A] text-white px-6 rounded-xl font-bold uppercase tracking-widest text-[10px] hover:bg-[#333] transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                        
                        <div className="flex items-start gap-3 p-4 bg-[#FFF8F5] rounded-xl border border-[#FFE7DD]">
                          <AlertCircle size={16} className="text-[#FF6B35] shrink-0 mt-0.5" />
                          <p className="text-[10px] text-[#8E4D35] leading-relaxed">
                            <strong>Note:</strong> Ensure the object's path is clearly visible. Gemini will estimate distance and time from static frames or scene context.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  <canvas ref={canvasRef} className="hidden" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-[#D1D1CB] mt-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-2">
            <h4 className="text-[10px] uppercase font-bold text-[#8E8E8A] mb-4 tracking-widest">Theoretical Framework</h4>
            <p className="text-xs text-[#5A5A57] leading-relaxed max-w-sm">
              This lab integrates classical kinematics equations with modern computer vision. Velocity and Speed calculations are derived from:
              <br /><br />
              <code className="bg-black text-[#FF6B35] px-2 py-1 rounded inline-block mt-1">v = Δx / Δt</code> &nbsp; 
              <code className="bg-black text-[#FF6B35] px-2 py-1 rounded inline-block mt-1">s = d / Δt</code>
            </p>
          </div>
          <div>
            <h4 className="text-[10px] uppercase font-bold text-[#8E8E8A] mb-4 tracking-widest">Tech Stack</h4>
            <ul className="text-[10px] space-y-2 font-bold uppercase tracking-wider text-[#5A5A57]">
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-[#FF6B35]" /> Python Stats & Math</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-[#FF6B35]" /> Gemini 1.5 Vision API</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-[#FF6B35]" /> SQL Experiment Log</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-[#FF6B35]" /> Recharts Analytics</li>
            </ul>
          </div>
          <div className="flex flex-col justify-end items-end">
            <p className="text-[10px] font-bold text-[#8E8E8A] uppercase tracking-widest">Research Copy 2026</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Utility SVG icon for empty state
function DATABASE_ICON({ size, className }: { size: number, className: string }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
    </svg>
  );
}

