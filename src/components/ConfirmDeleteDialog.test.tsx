import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import type { LibraryItem } from "../api";

const items: LibraryItem[] = [
  { id: 1, title: "Big Show", service: "sonarr", size_on_disk: 88_130_000_000, status: "ended", added: null, tags: [], tag_labels: [] },
  { id: 2, title: "Doc", service: "radarr", size_on_disk: 9_700_000_000, status: "released", added: null, tags: [], tag_labels: [] },
];

describe("ConfirmDeleteDialog", () => {
  it("lists every item and the total reclaimed size", () => {
    render(<ConfirmDeleteDialog items={items} onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText("Big Show")).toBeInTheDocument();
    expect(screen.getByText("Doc")).toBeInTheDocument();
    expect(screen.getByText(/97\.8 GB/)).toBeInTheDocument(); // 88.1 + 9.7
  });

  it("fires onConfirm when confirmed", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDeleteDialog items={items} onCancel={() => {}} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: /delete 2 items/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows live progress and hides the action buttons while deleting", () => {
    render(
      <ConfirmDeleteDialog items={items} onCancel={() => {}} onConfirm={() => {}}
        progress={{ done: 1, total: 2, current: "Doc" }} />
    );
    expect(screen.getByText(/Deleting 2 of 2 — Doc…/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete 2 items/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });
});
