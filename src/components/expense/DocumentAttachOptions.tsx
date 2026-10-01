// The ways a document gets onto an expense (SUBSTANTIATE_SPEC S1, S2).
//
// Three ways in, side by side: take a photo, choose a document already on
// file, upload a file. Reuse used to live only as a faint second button on
// each queue row -- outside the dialog, and nowhere at all when the dialog was
// opened from the All tab, the Review feed or the expense page -- which is how
// the founder missed it.
//
// On a phone the camera leads and is the largest target: receipts are
// photographed standing at a pharmacy counter. On a computer the camera
// option is dropped, because `capture` falls back to the same file picker as
// Upload there, so it was a duplicate button.

import { Camera, FolderOpen, Loader2, Upload } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { FILE_ACCEPT_ATTRIBUTE } from "@/utils/fileValidation";
import { cn } from "@/lib/utils";

interface DocumentAttachOptionsProps {
  /** Files picked from the camera or the file picker. */
  onFiles: (files: FileList | null) => void;
  /** Open the Documents library picker. */
  onChooseFromDocuments: () => void;
  uploading?: boolean;
}

const tile =
  "flex items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-sm transition-colors hover:border-primary hover:bg-accent/40 focus-within:border-primary";

export function DocumentAttachOptions({
  onFiles,
  onChooseFromDocuments,
  uploading = false,
}: DocumentAttachOptionsProps) {
  const isMobile = useIsMobile();

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFiles(e.target.files);
    e.target.value = "";
  };

  const upload = (
    <label className={cn(tile, "cursor-pointer")}>
      <input
        type="file"
        multiple
        accept={FILE_ACCEPT_ATTRIBUTE}
        className="sr-only"
        disabled={uploading}
        onChange={pick}
      />
      {uploading ? (
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      ) : (
        <Upload className="h-5 w-5" aria-hidden="true" />
      )}
      <span>{uploading ? "Uploading…" : "Upload a file"}</span>
    </label>
  );

  const choose = (
    <button
      type="button"
      className={tile}
      onClick={onChooseFromDocuments}
      disabled={uploading}
    >
      <FolderOpen className="h-5 w-5" aria-hidden="true" />
      <span>Choose from Documents</span>
    </button>
  );

  if (!isMobile) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {upload}
        {choose}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className={cn(tile, "cursor-pointer py-7 text-base")}>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={uploading}
          onChange={pick}
        />
        <Camera className="h-6 w-6" aria-hidden="true" />
        <span>Take a photo</span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        {choose}
        {upload}
      </div>
    </div>
  );
}
