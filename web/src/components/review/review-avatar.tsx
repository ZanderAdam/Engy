import { cn } from '@/lib/utils';

interface ReviewAvatarProps {
  login: string;
  avatarUrl: string | null;
  className?: string;
}

export function ReviewAvatar({ login, avatarUrl, className }: ReviewAvatarProps) {
  return (
    <span
      role="img"
      aria-label={login}
      title={login}
      style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted bg-cover text-[10px] font-medium uppercase text-muted-foreground',
        className,
      )}
    >
      {avatarUrl ? null : login.charAt(0)}
    </span>
  );
}
