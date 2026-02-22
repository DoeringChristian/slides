import React, { useState } from 'react';
import { Copy, Trash2, Presentation } from 'lucide-react';
import type { ProjectMeta } from '../../types/vault';

interface Props {
  project: ProjectMeta;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (months > 0) return `${months}mo ago`;
  if (weeks > 0) return `${weeks}w ago`;
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

export const ProjectCard: React.FC<Props> = ({ project, onOpen, onDuplicate, onDelete }) => {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showConfirm) {
      onDelete();
      setShowConfirm(false);
    } else {
      setShowConfirm(true);
    }
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirm(false);
  };

  return (
    <div
      onClick={onOpen}
      className="group relative flex flex-col border rounded-lg overflow-hidden hover:border-blue-400 hover:shadow-md transition-all text-left bg-white cursor-pointer"
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-gray-100 relative overflow-hidden">
        {project.thumbnailDataUrl ? (
          <img
            src={project.thumbnailDataUrl}
            alt={project.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <Presentation size={48} />
          </div>
        )}

        {/* Hover overlay with actions */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            className="p-2 bg-white rounded-full shadow hover:bg-gray-100 text-gray-600"
            title="Duplicate"
          >
            <Copy size={16} />
          </button>
          {showConfirm ? (
            <>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 bg-red-500 text-white rounded-full shadow hover:bg-red-600 text-sm font-medium"
              >
                Confirm
              </button>
              <button
                onClick={handleCancelDelete}
                className="px-3 py-1.5 bg-white rounded-full shadow hover:bg-gray-100 text-gray-600 text-sm font-medium"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={handleDelete}
              className="p-2 bg-white rounded-full shadow hover:bg-gray-100 text-gray-600 hover:text-red-500"
              title="Delete"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="font-medium text-gray-900 truncate">{project.title}</div>
        <div className="text-xs text-gray-400 mt-0.5">
          {formatRelativeTime(project.updatedAt)}
        </div>
      </div>
    </div>
  );
};

interface NewProjectCardProps {
  onClick: () => void;
}

export const NewProjectCard: React.FC<NewProjectCardProps> = ({ onClick }) => {
  return (
    <button
      onClick={onClick}
      className="flex flex-col border-2 border-dashed border-gray-300 rounded-lg overflow-hidden hover:border-blue-400 hover:bg-blue-50/50 transition-all text-left"
    >
      <div className="aspect-video flex items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="text-4xl font-light mb-1">+</div>
          <div className="text-sm font-medium">New Presentation</div>
        </div>
      </div>
      <div className="p-3">
        <div className="font-medium text-gray-500">Create new</div>
        <div className="text-xs text-gray-400 mt-0.5">Start from scratch</div>
      </div>
    </button>
  );
};
