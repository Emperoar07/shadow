export default function PrivacyBadge() {
  return (
    <div className="privacy-glow flex items-center gap-2 px-3 py-1 rounded-full bg-accent-purple/20 border border-accent-purple/40">
      <div className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
      <span className="text-xs font-medium text-accent-purple">
        MPC Encrypted
      </span>
    </div>
  );
}
