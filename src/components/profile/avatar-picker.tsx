"use client";

import Image from "next/image";
import { Camera, Check } from "lucide-react";
import { AVATAR_OPTIONS, AVATAR_PATHS } from "@/lib/domain/avatar-options";
import { AVATAR_ACCEPTED_TYPES } from "@/lib/domain/avatar-upload";

type AvatarPickerProps = {
  value: string | null;
  onChange: (value: string | null) => void;
  initials: string;
  disabled?: boolean;
  onUpload?: (file: File) => void | Promise<void>;
  uploading?: boolean;
};

export function AvatarPicker({ value, onChange, initials, disabled = false, onUpload, uploading = false }: AvatarPickerProps) {
  const customAvatar = value && !AVATAR_PATHS.includes(value as (typeof AVATAR_PATHS)[number])
    ? [{ value, label: "Your photo" }]
    : [];
  const choices = [...customAvatar, { value: null, label: "Use initials" }, ...AVATAR_OPTIONS];

  return (
    <fieldset disabled={disabled} aria-describedby="avatar-picker-help">
      <legend className="field-label">
        Profile photo <span className="font-normal text-muted">optional</span>
      </legend>
      <p id="avatar-picker-help" className="mt-1 text-sm text-muted">
        {onUpload ? "Upload your own square image, pick an illustration, or keep your initials." : "Pick an illustration, or keep your initials. You can upload a photo later from Edit profile."}
      </p>
      {onUpload && <div className="mt-4">
        <label className="btn btn-secondary cursor-pointer">
          <Camera size={16} /> {uploading ? "Uploading…" : "Upload photo"}
          <input
            type="file"
            accept={AVATAR_ACCEPTED_TYPES.join(",")}
            className="sr-only"
            aria-label="Upload profile photo"
            disabled={disabled || uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onUpload(file);
              event.target.value = "";
            }}
          />
        </label>
        <p className="mt-2 text-xs text-muted">JPG, PNG, or WebP · 2 MB max · square images work best</p>
      </div>}
      <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
        {choices.map((choice) => {
          const selected = value === choice.value;
          const preset = Boolean(choice.value && AVATAR_PATHS.includes(choice.value as (typeof AVATAR_PATHS)[number]));
          return (
            <label
              key={choice.value ?? "initials"}
              className={`relative flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border p-2 text-center text-xs font-bold transition ${selected ? "border-brand bg-brand-soft shadow-[0_0_0_2px_var(--brand)]" : "border-line bg-surface hover:border-line-strong hover:bg-surface-raised"} has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#2563eb] disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <input
                type="radio"
                name="avatar-choice"
                value={choice.value ?? ""}
                checked={selected}
                onChange={() => onChange(choice.value)}
                className="sr-only"
              />
              {choice.value && preset ? (
                <Image src={choice.value} alt="" width={64} height={64} className="h-16 w-16 rounded-full object-cover" />
              ) : choice.value ? (
                // User-uploaded and legacy avatar hosts are not known at build time.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={choice.value} alt="" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <span className="avatar avatar-human h-16 w-16 text-base" aria-hidden="true">{initials}</span>
              )}
              <span>{choice.label}</span>
              {selected && <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-brand text-white" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
