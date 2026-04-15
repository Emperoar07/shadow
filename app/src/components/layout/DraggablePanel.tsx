interface DraggablePanelProps {
  children: React.ReactNode;
  locked?: boolean;
  allowOverflow?: boolean;
}

export default function DraggablePanel({ children, locked = false, allowOverflow = false }: DraggablePanelProps) {
  return (
    <div className={`relative flex h-full flex-col bg-shadow-900 ${allowOverflow ? "overflow-visible border-b border-shadow-600" : "overflow-hidden"}`}>
      {!locked && (
        <div className="drag-handle absolute inset-x-0 top-0 z-[220] h-2 cursor-grab active:cursor-grabbing hover:bg-white/5 transition-colors" />
      )}
      <div className={`flex-1 min-h-0 ${allowOverflow ? "overflow-visible" : "overflow-auto"}`}>
        {children}
      </div>
    </div>
  );
}
