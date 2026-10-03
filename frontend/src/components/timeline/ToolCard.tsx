import React from 'react';
import type { ToolCall } from '@agy-studio/contracts';
import type { ToolItem } from '../../domain/timeline.types';
import { BrowserCard } from './cards/BrowserCard';
import { CommandCard } from './cards/CommandCard';
import { FileEditCard } from './cards/FileEditCard';
import { GenericToolCard } from './cards/GenericToolCard';
import { McpCard } from './cards/McpCard';
import { SearchCard } from './cards/SearchCard';

export interface ToolCardProps {
  item?: ToolItem;
  tool?: ToolCall;
  defaultExpanded?: boolean;
  /** Explicit user choice kept by the parent (survives virtualized row remounts). */
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  className?: string;
}

export function ToolCard({
  item,
  tool: explicitTool,
  defaultExpanded,
  expanded,
  onExpandedChange,
  className = '',
}: ToolCardProps) {
  const tool = explicitTool || item?.tool;

  if (!tool) {
    return null;
  }

  const shared = { tool, defaultExpanded, expanded, onExpandedChange, className };

  switch (tool.kind) {
    case 'view_file':
    case 'edit_file':
    case 'write_file':
      return <FileEditCard {...shared} />;

    case 'run_command':
      return <CommandCard {...shared} />;

    case 'search':
      return <SearchCard {...shared} />;

    case 'browser':
      return <BrowserCard {...shared} />;

    case 'mcp':
      return <McpCard {...shared} />;

    case 'other':
    case 'subagent':
    default:
      return <GenericToolCard {...shared} />;
  }
}

export {
  BrowserCard,
  CommandCard,
  FileEditCard,
  GenericToolCard,
  McpCard,
  SearchCard,
};
