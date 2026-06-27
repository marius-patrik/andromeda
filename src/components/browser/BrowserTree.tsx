import { ChevronDown, ChevronRight, Cpu, FileAudio, Folder, Music } from "lucide-react";
import * as React from "react";
import type { BrowserNode } from "../../views/shared/types.js";

export interface BrowserTreeProps {
  root: BrowserNode;
  onPreview: (nodeId: string) => void;
  onDragStart: (nodeId: string) => void;
}

export const BrowserTree: React.FC<BrowserTreeProps> = ({ root, onPreview, onDragStart }) => {
  if ((root.children?.length ?? 0) === 0) {
    return (
      <output
        aria-live="polite"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--vsdaw-fg)",
          opacity: 0.5,
          fontSize: 12,
        }}
      >
        Browser is empty
      </output>
    );
  }

  return (
    <div
      role="tree"
      aria-label="Browser tree"
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        padding: "4px 0",
      }}
    >
      {root.children?.map((child: BrowserNode) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={0}
          onPreview={onPreview}
          onDragStart={onDragStart}
        />
      ))}
    </div>
  );
};

const TreeNode: React.FC<{
  node: BrowserNode;
  depth: number;
  onPreview: (nodeId: string) => void;
  onDragStart: (nodeId: string) => void;
}> = ({ node, depth, onPreview, onDragStart }) => {
  const [expanded, setExpanded] = React.useState(true);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isLeaf = node.type === "file" || node.type === "device";
  const Icon =
    node.type === "folder"
      ? Folder
      : node.type === "device"
        ? Cpu
        : node.name.toLowerCase().endsWith(".mid")
          ? Music
          : FileAudio;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" && hasChildren && !expanded) setExpanded(true);
    if (e.key === "ArrowLeft" && hasChildren && expanded) setExpanded(false);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (isLeaf) onPreview(node.id);
      else if (hasChildren) setExpanded((s) => !s);
    }
  };

  return (
    <div role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div
        draggable={isLeaf}
        onDragStart={() => onDragStart(node.id)}
        onClick={() => {
          if (isLeaf) onPreview(node.id);
          else if (hasChildren) setExpanded((e) => !e);
        }}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label={node.name}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          paddingLeft: 8 + depth * 16,
          cursor: "pointer",
          outline: "none",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--vsdaw-hover-bg)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
        onFocus={(e) => {
          e.currentTarget.style.backgroundColor = "var(--vsdaw-hover-bg)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )
        ) : (
          <span style={{ width: 14 }} />
        )}
        <Icon size={14} />
        <span
          style={{
            fontSize: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {node.name}
        </span>
      </div>
      {expanded && hasChildren && (
        <div role="group">
          {node.children?.map((child: BrowserNode) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onPreview={onPreview}
              onDragStart={onDragStart}
            />
          ))}
        </div>
      )}
    </div>
  );
};
