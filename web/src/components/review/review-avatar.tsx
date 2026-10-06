interface ReviewAvatarProps {
  login: string;
  avatarUrl: string | null;
}

export function ReviewAvatar({ login, avatarUrl }: ReviewAvatarProps) {
  return (
    <span
      role="img"
      aria-label={login}
      title={login}
      style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted bg-cover text-[10px] font-medium uppercase text-muted-foreground"
    >
      {avatarUrl ? null : login.charAt(0)}
    </span>
  );
}
