interface BattProps {
  size?: number | string;
  batteryPercent: number;
  style?: React.CSSProperties;
}

const Battery: React.FC<BattProps> = ({ size = 24, batteryPercent, style }) => {
  const percent = Math.min(Math.max(batteryPercent, 0), 100);
  const isLow = percent < 20;

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ 
        verticalAlign: 'middle', 
        animation: isLow ? 'blink 1.5s infinite' : 'none',
        ...style 
      }}
    >
      <style>{`
        @keyframes blink {
          0% { opacity: 1; }
          50% { opacity: 0.4; }
          100% { opacity: 1; }
        }
      `}</style>

      <rect x="2" y="8" width="38" height="20" rx="4" ry="4" />
      
      <rect 
        x="5" 
        y="11" 
        width={(percent / 100) * 32} 
        height="14" 
        rx="2" 
        ry="2" 
        fill="currentColor" 
        stroke="none"
      />
      
      <path d="M45 14v8" strokeWidth={3} />
    </svg>
  );
};

export default Battery;