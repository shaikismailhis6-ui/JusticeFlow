import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2, FileText, AlertTriangle, Download } from 'lucide-react';
import { storage } from '../firebase';
import { ref as storageRef, getBlob } from 'firebase/storage';

// Use a CDN for the worker to ensure it loads correctly and quickly
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.mjs`;

interface PDFRendererProps {
  data: string;
  textContent?: string;
}

export default function PDFRenderer({ data, textContent }: PDFRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderTask, setRenderTask] = useState<pdfjs.RenderTask | null>(null);

  useEffect(() => {
    const loadPdf = async () => {
      if (!data) {
        setError('No evidence data provided.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setPdf(null);
      setNumPages(0);
      setPageNum(1);

      try {
        let bytes: Uint8Array;

        if (data.startsWith('http')) {
          // Use Firebase SDK getBlob - it's much more reliable for CORS than raw fetch
          const fileRef = storageRef(storage, data);
          const blob = await getBlob(fileRef);
          const arrayBuffer = await blob.arrayBuffer();
          bytes = new Uint8Array(arrayBuffer);
        } else {
          // Handle base64 data
          const base64Match = data.match(/base64,(.*)$/);
          const pureBase64 = base64Match ? base64Match[1] : data.trim();
          const safeBase64 = pureBase64.replace(/[^A-Za-z0-9+/=]/g, '');
          const binaryString = atob(safeBase64);
          bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
        }

        const loadingTask = pdfjs.getDocument({ 
          data: bytes,
          verbosity: 0
        });
        
        const pdfDoc = await loadingTask.promise;
        setPdf(pdfDoc);
        setNumPages(pdfDoc.numPages);
      } catch (err: any) {
        console.error('Error loading PDF:', err);
        setError(err.message || 'Failed to render PDF evidence.');
      }
      setLoading(false);
    };

    loadPdf();
  }, [data]);

  useEffect(() => {
    const renderPage = async () => {
      if (!pdf || !canvasRef.current) return;

      // Cancel previous render task if it exists
      if (renderTask) {
        renderTask.cancel();
      }

      try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: scale * window.devicePixelRatio });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        if (!context) return;

        // Set display size
        canvas.style.width = `${viewport.width / window.devicePixelRatio}px`;
        canvas.style.height = `${viewport.height / window.devicePixelRatio}px`;
        
        // Set actual canvas size for high DPI
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const task = page.render({
          canvasContext: context,
          viewport: viewport,
        });

        setRenderTask(task);
        await task.promise;
      } catch (error: any) {
        if (error.name === 'RenderingCancelledException') {
          // Normal cancellation, ignore
          return;
        }
        console.error('Error rendering page:', error);
      }
    };

    renderPage();
  }, [pdf, pageNum, scale]);

  const changePage = (offset: number) => {
    setPageNum(prev => Math.min(Math.max(1, prev + offset), numPages));
  };

  return (
    <div className="flex flex-col h-full bg-surface/50 rounded-xl overflow-hidden border border-border-main">
      {/* Toolbar */}
      {numPages > 0 && (
        <div className="bg-surface/80 border-b border-border-main px-4 py-2 flex items-center justify-between z-10">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <button 
                onClick={() => changePage(-1)} 
                disabled={pageNum <= 1}
                className="p-1 hover:bg-surface rounded disabled:opacity-30 text-text-main transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest min-w-[60px] text-center">
                Page {pageNum} / {numPages}
              </span>
              <button 
                onClick={() => changePage(1)} 
                disabled={pageNum >= numPages}
                className="p-1 hover:bg-surface rounded disabled:opacity-30 text-text-main transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="h-4 w-px bg-border-main" />
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setScale(prev => Math.max(0.5, prev - 0.2))}
                className="p-1 hover:bg-surface rounded text-text-main transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setScale(prev => Math.min(3, prev + 0.2))}
                className="p-1 hover:bg-surface rounded text-text-main transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <a 
              href={data} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1 bg-brand-accent/10 hover:bg-brand-accent/20 text-brand-accent rounded-lg transition-all text-[10px] font-bold uppercase tracking-widest"
            >
              <Download className="w-3 h-3" />
              Download
            </a>
          </div>
        </div>
      )}

      {/* Rendering Area */}
      <div className="flex-1 overflow-auto p-4 flex justify-center bg-surface/30 scrollbar-thin scrollbar-thumb-border-main scrollbar-track-transparent relative">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-4 absolute inset-0">
            <Loader2 className="w-8 h-8 text-brand-accent animate-spin" />
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Streaming Forensic Evidence...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-4 p-10 text-center max-w-2xl w-full">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-2 shrink-0">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <p className="text-text-main font-bold">Forensic Rendering Failed</p>
            <p className="text-text-muted text-xs leading-relaxed mb-4">{error}</p>
            
            <div className="flex gap-4">
              <a 
                href={data} 
                target="_blank" 
                rel="noopener noreferrer"
                className="px-6 py-2 bg-brand-accent text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-brand-accent/90 transition-all shadow-lg shadow-brand-accent/20"
              >
                Open Original
              </a>
              <button 
                onClick={() => window.location.reload()}
                className="px-6 py-2 border border-border-main text-text-muted rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-surface transition-all"
              >
                Retry
              </button>
            </div>
            
            {textContent && (
              <div className="w-full mt-8 bg-surface/50 p-6 rounded-xl border border-border-main text-left overflow-y-auto max-h-[300px]">
                <p className="text-[10px] font-bold text-brand-accent uppercase tracking-widest mb-4 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Recovered Text Content
                </p>
                <div className="font-serif text-sm text-text-main whitespace-pre-wrap leading-relaxed">
                  {textContent}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="relative">
            <canvas ref={canvasRef} className="shadow-2xl rounded-sm max-w-full h-auto bg-white" />
          </div>
        )}
      </div>
    </div>
  );
}
