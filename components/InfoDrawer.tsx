'use client';

import { Fragment, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';

type InfoDrawerProps = {
  label: string;
  markdown: string;
  title: string;
  variant?: 'site' | 'dashboard';
};

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function inlineMarkdown(value: string) {
  const tokens = value.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|_[^_]+_)/g).filter(Boolean);
  return tokens.map((token, index): ReactNode => {
    if (token.startsWith('**') && token.endsWith('**')) return <strong key={index}>{token.slice(2, -2)}</strong>;
    if (token.startsWith('`') && token.endsWith('`')) return <code key={index}>{token.slice(1, -1)}</code>;
    if (token.startsWith('_') && token.endsWith('_')) return <em key={index}>{token.slice(1, -1)}</em>;
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a href={link[2]} key={index} rel="noreferrer" target={link[2].startsWith('http') ? '_blank' : undefined}>{link[1]}</a>;
    return <Fragment key={index}>{token}</Fragment>;
  });
}

function tableCells(line: string) {
  return line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function isBlockStart(line: string, nextLine = '') {
  return /^#{1,3} /.test(line) || /^- /.test(line) || /^\d+\. /.test(line) || (line.startsWith('|') && /^\|?[\s:|-]+\|?$/.test(nextLine));
}

function MarkdownContent({ markdown, idPrefix }: { markdown: string; idPrefix: string }) {
  const lines = markdown.replace(/^# .+\r?\n/, '').split(/\r?\n/);
  const blocks: ReactNode[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }

    const heading = line.match(/^(#{2,3}) (.+)$/);
    if (heading) {
      const id = `${idPrefix}-${slugify(heading[2])}`;
      blocks.push(heading[1].length === 2
        ? <h2 id={id} key={index}>{inlineMarkdown(heading[2])}</h2>
        : <h3 id={id} key={index}>{inlineMarkdown(heading[2])}</h3>);
      index += 1;
      continue;
    }

    if (line.startsWith('|') && lines[index + 1]?.trim().match(/^\|?[\s:|-]+\|?$/)) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(tableCells(lines[index].trim()));
        index += 1;
      }
      blocks.push(<div className="info-table-wrap" key={`table-${index}`}><table><thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{inlineMarkdown(cell)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inlineMarkdown(cell)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }

    if (/^- /.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].trim().match(/^- (.+)$/);
        if (!item) break;
        items.push(item[1]); index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ul>);
      continue;
    }

    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      const start = Number(line.match(/^(\d+)\./)?.[1] || 1);
      while (index < lines.length) {
        const item = lines[index].trim().match(/^\d+\. (.+)$/);
        if (!item) break;
        items.push(item[1]); index += 1;
      }
      blocks.push(<ol key={`steps-${index}`} start={start}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ol>);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index].trim(), lines[index + 1]?.trim())) {
      paragraph.push(lines[index].trim()); index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraph.join(' '))}</p>);
  }

  return blocks;
}

export default function InfoDrawer({ label, markdown, title, variant = 'site' }: InfoDrawerProps) {
  const [open, setOpen] = useState(false);
  const reactId = useId().replace(/:/g, '');
  const titleId = `info-title-${reactId}`;
  const idPrefix = `info-${reactId}`;
  const closeButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const triggerButton = useRef<HTMLButtonElement>(null);
  const sections = useMemo(() => markdown.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^## (.+)$/);
    return match ? [{ label: match[1], id: `${idPrefix}-${slugify(match[1])}` }] : [];
  }), [idPrefix, markdown]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerButton.current;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'Tab') {
        const focusable = drawer.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  return <>
    <button className={`info-trigger info-trigger-${variant}`} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} ref={triggerButton}><span aria-hidden="true">i</span><span className="sr-only">{label}</span></button>
    {open && <div className="info-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="info-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={drawer}>
        <header><div><small>Information</small><h2 id={titleId}>{title}</h2></div><button className="info-close" type="button" aria-label={`Close ${label}`} onClick={() => setOpen(false)} ref={closeButton}>×</button></header>
        <div className="info-scroll">
          <nav className="info-toc" aria-label={`${title} sections`}>{sections.map((section) => <a href={`#${section.id}`} key={section.id}>{section.label}</a>)}</nav>
          <article className="info-markdown"><MarkdownContent markdown={markdown} idPrefix={idPrefix} /></article>
        </div>
      </section>
    </div>}
  </>;
}
