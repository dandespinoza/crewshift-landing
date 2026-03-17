'use client';

function GreetingHeader() {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const formatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="flex items-end justify-between">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">{greeting}, Dan</h1>
        <p className="mt-1 text-base text-text-tertiary">{formatted}</p>
      </div>
    </div>
  );
}

export { GreetingHeader };
