/**
 * WellbieAvatar - AI Companion Mascot
 *
 * USAGE GUIDE:
 * ------------
 * - Use for conversational moments, chat interfaces, and onboarding
 * - Use for loading/thinking states with the "thinking" variant
 * - NOT for navigation or branding (use ReclaimLogo instead)
 *
 * PERSONALITY: Supportive coach + analytical guide
 * - Calm, helpful, slightly playful
 * - Appears during results explanations, tips, and notifications
 */

interface WellbieAvatarProps {
  size?: "sm" | "md" | "lg";
  animate?: boolean;
  state?: "default" | "thinking" | "success";
  className?: string;
}

export const WellbieAvatar = ({
  size = "md",
  animate = false,
  state = "default",
  className = "",
}: WellbieAvatarProps) => {
  const sizes = {
    sm: "h-8 w-8",
    md: "h-12 w-12",
    lg: "h-16 w-16",
  };

  const getAnimation = () => {
    if (animate) return "animate-bounce";
    if (state === "thinking") return "animate-pulse";
    return "";
  };

  return (
    <div
      className={`${sizes[size]} ${className} transition-transform duration-200 hover:scale-110 hover:animate-bounce`}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={getAnimation()}
      >
        {/* Wellbie - Refined geometric orb with sophisticated gradient */}
        <defs>
          <linearGradient
            id="wellbie-gradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="hsl(178, 100%, 38%)" />
            <stop offset="50%" stopColor="hsl(178, 90%, 35%)" />
            <stop offset="100%" stopColor="hsl(178, 80%, 42%)" />
          </linearGradient>
          <linearGradient
            id="accent-gradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="hsl(43, 88%, 65%)" />
            <stop offset="100%" stopColor="hsl(43, 88%, 58%)" />
          </linearGradient>
        </defs>

        {/* Main body - smooth geometric circle */}
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="url(#wellbie-gradient)"
          className="transition-all duration-300"
        />

        {/* Gold accent - refined wellness symbol */}
        <path
          d="M 50 28 Q 56 28 56 36 Q 56 40 53 44 L 50 47 L 47 44 Q 44 40 44 36 Q 44 28 50 28 Z"
          fill="url(#accent-gradient)"
          opacity="0.95"
        />

        {/* Eyes - simplified and geometric */}
        <circle cx="40" cy="46" r="2.5" fill="white" opacity="0.85" />
        <circle cx="60" cy="46" r="2.5" fill="white" opacity="0.85" />

        {/* Expression based on state */}
        {state === "success" ? (
          <path
            d="M 36 56 Q 50 66 64 56"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
            opacity="0.8"
          />
        ) : state === "thinking" ? (
          <>
            <circle cx="42" cy="60" r="1.5" fill="white" opacity="0.6" />
            <circle cx="50" cy="60" r="1.5" fill="white" opacity="0.6" />
            <circle cx="58" cy="60" r="1.5" fill="white" opacity="0.6" />
          </>
        ) : (
          <path
            d="M 38 58 Q 50 64 62 58"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
            opacity="0.75"
          />
        )}
      </svg>
    </div>
  );
};
