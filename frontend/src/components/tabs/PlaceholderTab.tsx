type Props = { title: string };

export function PlaceholderTab({ title }: Props) {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700">
      <p className="text-sm text-zinc-500">{title} — coming soon</p>
    </div>
  );
}
