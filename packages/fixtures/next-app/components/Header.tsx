import clsx from "clsx";

type HeaderProps = { title: string; subtitle?: string };

export function Header({ title, subtitle = "sub" }: HeaderProps) {
  return (
    <header className={clsx("header")}>
      <h1>{title}</h1>
      {subtitle ? <h2>{subtitle}</h2> : null}
    </header>
  );
}
