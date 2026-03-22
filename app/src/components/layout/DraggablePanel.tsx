interface DraggablePanelProps {
  children: React.ReactNode;
  locked?: boolean;
  allowOverflow?: boolean;
}

export default function DraggablePanel({ children, locked = false, allowOverflow = false }: DraggablePanelProps) {
  return (
    <div className={`flex flex-col h-full bg-shadow-900 ${allowOverflow ? "" : "overflow-hidden"}`}>
      {!locked && (
        <div className="drag-handle shrink-0 h-2 cursor-grab active:cursor-grabbing hover:bg-white/5 transition-colors" />
      )}
      <div className={`flex-1 min-h-0 ${allowOverflow ? "overflow-visible" : "overflow-auto"}`}>
        {children}
      </div>
    </div>
  );
}
