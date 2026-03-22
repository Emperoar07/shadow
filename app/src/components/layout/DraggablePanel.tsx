interface DraggablePanelProps {
  children: React.ReactNode;
  locked?: boolean;
  allowOverflow?: boolean;
}

export default function DraggablePanel({ children, locked = false, allowOverflow = false }: DraggablePanelProps) {
  return (
    <div className={`relative flex flex-col h-full bg-shadow-900 ${allowOverflow ? "" : "overflow-hidden"}`}>
      {!locked && (
        <div className="drag-handle absolute top-0 left-0 right-0 h-3 cursor-grab active:cursor-grabbing z-0 hover:bg-white/5 transition-colors" />
      )}
      <div className={`flex-1 min-h-0 relative z-[1] ${allowOverflow ? "overflow-visible" : "overflow-auto"}`}>
        {children}
      </div>
    </div>
  );
}
