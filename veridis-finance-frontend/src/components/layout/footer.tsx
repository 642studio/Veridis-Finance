export function Footer() {
  return (
    <footer className="border-t border-border/70 bg-background/80">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6 lg:px-8">
        <p>Veridis Finance SaaS Frontend</p>
        <p>{new Date().getFullYear()} 642 Studio. All rights reserved.</p>
      </div>
    </footer>
  );
}
