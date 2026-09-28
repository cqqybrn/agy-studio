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
  className?: string;
}

export function ToolCard({
  item,
  tool: explicitTool,
  defaultExpanded,
  className = '',
}: ToolCardProps) {
  const tool = explicitTool || item?.tool;

  if (!tool) {
    return null;
  }

  switch (tool.kind) {
    case 'view_file':
    case 'edit_file':
    case 'write_file':
      return (
        <FileEditCard
          tool={tool}
          defaultExpanded={defaultExpanded}
          className={className}
        />
      );

    case 'run_command':
      return (
        <CommandCard
          tool={tool}
          defaultExpanded={defaultExpanded ?? true}
          className={className}
        />
      );

    case 'search':
      return (
        <SearchCard
          tool={tool}
          defaultExpanded={defaultExpanded}
          className={className}
        />
      );

    case 'browser':
      return (
        <BrowserCard
          tool={tool}
          defaultExpanded={defaultExpanded}
          className={className}
        />
      );

    case 'mcp':
      return (
        <McpCard
          tool={tool}
          defaultExpanded={defaultExpanded}
          className={className}
        />
      );

    case 'other':
    case 'subagent':
    default:
      return (
        <GenericToolCard
          tool={tool}
          defaultExpanded={defaultExpanded}
          className={className}
        />
      );
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
