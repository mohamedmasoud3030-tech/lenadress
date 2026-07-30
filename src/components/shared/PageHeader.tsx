type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
};

export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <div className="min-w-0">
      <p className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-extrabold text-amber-900 ring-1 ring-amber-200">
        {eyebrow}
      </p>
      {/* Smaller on phones: a 3xl Arabic title wrapped to three lines at 360px. */}
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
      {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p> : null}
    </div>
  );
}
