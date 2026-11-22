import React, { useState, useMemo } from 'react';
import type { TaskItem } from '../../../src/types.js';
import { MockTaskBackend } from '../../../src/oracle/mock-api.js';

export interface ReactTaskManagerProps {
  initialTasks?: TaskItem[];
  backend?: MockTaskBackend;
}

export const ReactTaskManager: React.FC<ReactTaskManagerProps> = ({
  initialTasks,
  backend,
}) => {
  const [tasks, setTasks] = useState<TaskItem[]>(() =>
    initialTasks ? JSON.parse(JSON.stringify(initialTasks)) : []
  );
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterPriority, setFilterPriority] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filtered task calculation
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // Status filter
      if (filterStatus === 'Active' && t.status !== 'Active') return false;
      if (filterStatus === 'Completed' && t.status !== 'Completed') return false;

      // Priority filter
      if (filterPriority !== 'All' && t.priority !== filterPriority) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inTitle = t.title.toLowerCase().includes(q);
        const inTags = t.tags && t.tags.some((tag) => tag.toLowerCase().includes(q));
        if (!inTitle && !inTags) return false;
      }

      return true;
    });
  }, [tasks, filterStatus, filterPriority, searchQuery]);

  // Actions
  const handleAddTask = (title: string) => {
    if (!title.trim()) return;
    const newTask: TaskItem = {
      id: `task-${Date.now()}`,
      title: title.trim(),
      status: 'Active',
      priority: 'Medium',
      tags: [],
      updatedAt: Date.now(),
    };
    setTasks((prev) => [...prev, newTask]);
  };

  const handleToggleTask = (id: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, status: t.status === 'Active' ? 'Completed' : 'Active' }
          : t
      )
    );
  };

  const handleSaveTasks = async () => {
    if (!backend) return;
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await backend.saveTasks(tasks);
      setIsSaving(false);
      setSuccessMessage('Saved successfully');
    } catch (err: any) {
      setIsSaving(false);
      setErrorMessage(err?.message || 'Failed to save tasks');
      throw err;
    }
  };

  const handleRetrySave = async () => {
    return handleSaveTasks();
  };

  const handleOptimisticToggleTask = async (id: string) => {
    const priorTask = tasks.find((t) => t.id === id);
    if (!priorTask) return;

    const optimisticStatus: 'Active' | 'Completed' =
      priorTask.status === 'Active' ? 'Completed' : 'Active';

    // Apply optimistic update immediately
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: optimisticStatus } : t))
    );

    if (backend) {
      try {
        await backend.syncTask({ ...priorTask, status: optimisticStatus });
      } catch (err: any) {
        // Rollback to prior status on failure
        setTasks((prev) =>
          prev.map((t) => (t.id === id ? { ...t, status: priorTask.status } : t))
        );
        setErrorMessage(err?.message || 'Optimistic sync failed');
        throw err;
      }
    }
  };

  return (
    <div className="task-manager" data-agent-id="task-manager:root">
      <header>
        <h1>Task Manager (React)</h1>
        <span data-agent-id="task-manager:count">Total: {tasks.length}</span>
      </header>

      {/* Error banner */}
      {errorMessage && (
        <div role="alert" className="error-banner" data-agent-id="task-manager:error-banner">
          <span>{errorMessage}</span>
          <button
            data-agent-id="task-manager:retry-btn"
            data-testid="retry-btn"
            onClick={handleRetrySave}
          >
            Retry
          </button>
        </div>
      )}

      {/* Success banner */}
      {successMessage && (
        <div className="success-banner" data-agent-id="task-manager:success-banner">
          {successMessage}
        </div>
      )}

      {/* Search and Filters */}
      <section className="controls">
        <input
          type="text"
          placeholder="Search tasks or tags..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          data-agent-id="task-manager:search"
          data-testid="search-input"
        />

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          data-agent-id="task-manager:status-filter"
          data-testid="status-filter"
        >
          <option value="All">All Status</option>
          <option value="Active">Active</option>
          <option value="Completed">Completed</option>
        </select>

        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          data-agent-id="task-manager:priority-filter"
        >
          <option value="All">All Priorities</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>

        <button
          disabled={isSaving}
          onClick={handleSaveTasks}
          data-agent-id="task-manager:save-btn"
          data-testid="save-btn"
        >
          {isSaving ? 'Saving...' : 'Save Tasks'}
        </button>
      </section>

      {/* Task List */}
      <ul className="task-list" data-agent-id="task-manager:list">
        {filteredTasks.map((t) => (
          <li
            key={t.id}
            className={`task-item ${t.status.toLowerCase()}`}
            data-agent-id={`task-item:${t.id}`}
          >
            <input
              type="checkbox"
              checked={t.status === 'Completed'}
              onChange={() => handleToggleTask(t.id)}
            />
            <span className="title">{t.title}</span>
            <span className={`badge ${t.priority.toLowerCase()}`}>{t.priority}</span>
            <div className="tags">
              {t.tags && t.tags.map((tag) => <span key={tag} className="tag">#{tag}</span>)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
