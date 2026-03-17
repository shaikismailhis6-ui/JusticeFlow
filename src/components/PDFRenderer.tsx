import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2, FileText, AlertTriangle } from 'lucide-react';
import { storage } from '../firebase';
import { ref as storageRef, getBlob } from 'firebase/storage';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

interface PDFRendererProps {
  data: string;
  textContent?: string;
}

export default function PDFRenderer({ data, textContent }: PDFRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const loadPdf = async () => {
      if (!data) {
        setError('No evidence data provided.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      
      // Cleanup previous object URL
      if (objectUrl && objectUrl.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
      }
      setObjectUrl(null);

      try {
        let bytes: Uint8Array;
        
        if (data.startsWith('http')) {
          try {
            // Fetch the PDF as a blob to bypass iframe cross-origin restrictions
            const fileRef = storageRef(storage, data);
            const blob = await getBlob(fileRef);
            const url = URL.createObjectURL(blob);
            setObjectUrl(url);
            
            // We still load it into pdf.js for the canvas fallback if needed
            const buffer = await blob.arrayBuffer();
            bytes = new Uint8Array(buffer);
          } catch (sdkErr) {
            console.warn('Firebase SDK fetch failed, falling back to direct URL:', sdkErr);
            // If fetch fails (likely CORS), use the URL directly in the iframe
            // This is a last resort as Chrome might still block it, but it's better than a JS error
            setObjectUrl(data);
            setLoading(false);
            return;
          }
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
          
          const blob = new Blob([bytes], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          setObjectUrl(url);
        }

        const loadingTask = pdfjs.getDocument({ 
          data: bytes,
          verbosity: 0
        });
        
        const pdfDoc = await loadingTask.promise;
        setPdf(pdfDoc);
        setNumPages(pdfDoc.numPages);
        setPageNum(1);
      } catch (err: any) {
        console.error('Error loading PDF:', err);
        setError(err.message || 'Failed to render PDF evidence.');
      }
      setLoading(false);
    };

    loadPdf();
    
    return () => {
      if (objectUrl && objectUrl.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [data]);

  useEffect(() => {
    const renderPage = async () => {
      if (!pdf || !canvasRef.current) return;

      try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        if (!context) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
          canvas: canvas, // Add the canvas element itself
        };

        await page.render(renderContext).promise;
      } catch (error) {
        console.error('Error rendering page:', error);
      }
    };

    renderPage();
  }, [pdf, pageNum, scale]);

  const changePage = (offset: number) => {
    setPageNum(prev => Math.min(Math.max(1, prev + offset), numPages));
  };

  // If the data is an HTTP URL, we now fetch it and render it via pdf.js
  // to avoid Chrome blocking direct PDF embedding in iframes.
  
  return (
    <div className="flex flex-col h-full bg-surface/50 rounded-xl overflow-hidden border border-border-main">
      {/* Toolbar */}
      {numPages > 0 && (
        <div className="bg-surface/80 border-b border-border-main px-4 py-2 flex items-center justify-between">
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
                onClick={() => setScale(prev => Math.max(0.5, prev - 0.25))}
                className="p-1 hover:bg-surface rounded text-text-main transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setScale(prev => Math.min(3, prev + 0.25))}
                className="p-1 hover:bg-surface rounded text-text-main transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
            <div className="h-4 w-px bg-border-main" />
            <a 
              href={data} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1 bg-brand-accent/10 hover:bg-brand-accent/20 text-brand-accent rounded-lg transition-all text-[10px] font-bold uppercase tracking-widest"
            >
              <FileText className="w-3 h-3" />
              Open Original
            </a>
          </div>
        </div>
      )}

      {/* Canvas Area */}
      <div className="flex-1 overflow-auto p-4 flex justify-center bg-surface/30 scrollbar-thin scrollbar-thumb-border-main scrollbar-track-transparent">
        {objectUrl ? (
          <iframe 
            src={`${objectUrl}#toolbar=0&navpanes=0&scrollbar=0`}
            className="w-full h-full rounded-lg border-none bg-white"
            title="PDF Evidence Preview"
          />
        ) : loading ? (
          <div className="flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-8 h-8 text-brand-accent animate-spin" />
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Rendering Evidence...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-4 p-10 text-center max-w-2xl w-full">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-2 shrink-0">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <p className="text-text-main font-bold">Forensic Rendering Failed</p>
            <p className="text-text-muted text-xs leading-relaxed mb-4">
              {error.includes('Failed to fetch') 
                ? 'Security Block (CORS): The browser blocked the direct fetch of this document. This usually happens when the storage bucket is not configured to allow cross-origin requests.' 
                : error}
            </p>
            
            <div className="flex flex-col gap-4 w-full items-center">
              <div className="flex gap-4">
                <a 
                  href={data} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="px-6 py-2 bg-brand-accent text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-brand-accent/90 transition-all shadow-lg shadow-brand-accent/20"
                >
                  Open in New Tab
                </a>
                <button 
                  onClick={() => window.location.reload()}
                  className="px-6 py-2 border border-border-main text-text-muted rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-surface transition-all"
                >
                  Retry
                </button>
              </div>

              {error.includes('Failed to fetch') && (
                <div className="mt-4 p-4 bg-surface/80 border border-border-main rounded-xl text-left w-full">
                  <p className="text-[9px] font-bold text-brand-accent uppercase tracking-widest mb-2">CORS Troubleshooting Guide</p>
                  <p className="text-[10px] text-text-muted leading-relaxed">
                    To fix this permanently, run the following command in your terminal using <code className="bg-surface px-1 rounded">gsutil</code>:
                  </p>
                  <pre className="mt-2 p-2 bg-bg-deep rounded text-[9px] text-text-main overflow-x-auto">
                    {`gsutil cors set cors.json gs://buddynear.firebasestorage.app`}
                  </pre>
                  <p className="text-[10px] text-text-muted mt-2">
                    Where <code className="bg-surface px-1 rounded">cors.json</code> contains:
                    <code className="block mt-1 bg-bg-deep p-2 rounded">
                      [{"{"}"origin": ["*"], "method": ["GET"], "maxAgeSeconds": 3600{"}"}]
                    </code>
                  </p>
                </div>
              )}
            </div>
            
            {textContent && (
              <div className="w-full bg-surface/50 p-6 rounded-xl border border-border-main text-left overflow-y-auto max-h-[400px] shadow-inner">
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
          <canvas ref={canvasRef} className="shadow-2xl rounded-sm max-w-full h-auto" />
        )}
      </div>
    </div>
  );
}
