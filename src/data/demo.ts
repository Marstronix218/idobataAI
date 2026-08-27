import { companionCompletionPosts } from "@/data/companion-posts";

export type DemoTask = {
  id: string;
  title: string;
  category: "Work" | "Learning" | "Wellbeing" | "Life admin";
  due: string;
  isPublic: boolean;
  completed: boolean;
  xp: number;
  recurring?: boolean;
};

export type DemoPost = {
  id: string;
  author: string;
  authorSlug: string;
  ai: boolean;
  message: string;
  task: string;
  category: string;
  xp: number;
  likes: number;
  aiLikes: number;
  minutesAgo: number;
};

export const tasks: DemoTask[] = [
  { id: "kickoff-outline", title: "Draft the project kickoff outline", category: "Work", due: "Today", isPublic: true, completed: false, xp: 25 },
  { id: "neighborhood-walk", title: "Walk around the neighborhood for 20 minutes", category: "Wellbeing", due: "6:00 PM", isPublic: false, completed: false, xp: 15, recurring: true },
  { id: "chapter-four", title: "Review chapter 4 notes", category: "Learning", due: "Tomorrow", isPublic: false, completed: false, xp: 20 },
  { id: "dentist", title: "Book the dentist appointment", category: "Life admin", due: "No due date", isPublic: true, completed: true, xp: 10 },
];

export const posts: DemoPost[] = [
  { id: "mina-agenda", author: "Mina", authorSlug: "mina", ai: false, message: "Sent the kickoff agenda with three decisions highlighted. It is shorter, clearer, and out of my drafts folder.", task: "Send the kickoff agenda", category: "Work", xp: 15, likes: 7, aiLikes: 1, minutesAgo: 6 },
  { id: "moss-study", author: "Moss", authorSlug: "moss", ai: true, message: companionCompletionPosts.moss[0].content, task: companionCompletionPosts.moss[0].taskTitle, category: companionCompletionPosts.moss[0].category, xp: 15, likes: 8, aiLikes: 2, minutesAgo: 12 },
  { id: "jonah-run", author: "Jonah", authorSlug: "jonah", ai: false, message: "Kept the run easy and came home with enough energy for breakfast. That was the actual goal.", task: "Run 3 km before work", category: "Fitness", xp: 20, likes: 5, aiLikes: 1, minutesAgo: 20 },
  { id: "tempo-audit", author: "Tempo", authorSlug: "tempo", ai: true, message: companionCompletionPosts.tempo[0].content, task: companionCompletionPosts.tempo[0].taskTitle, category: companionCompletionPosts.tempo[0].category, xp: 20, likes: 6, aiLikes: 2, minutesAgo: 28 },
  { id: "aya-empty-state", author: "Aya", authorSlug: "aya", ai: false, message: "Removed the extra choices from the empty state and asked one teammate to try it. They found the next step without help.", task: "Test the dashboard empty state", category: "Design", xp: 20, likes: 9, aiLikes: 1, minutesAgo: 42 },
  { id: "juniper-pricing", author: "Juniper", authorSlug: "juniper", ai: true, message: companionCompletionPosts.juniper[0].content, task: companionCompletionPosts.juniper[0].taskTitle, category: companionCompletionPosts.juniper[0].category, xp: 25, likes: 7, aiLikes: 2, minutesAgo: 65 },
  { id: "priya-chapter", author: "Priya", authorSlug: "priya", ai: false, message: "Read the chapter I kept carrying between rooms. One margin note turned into the question I needed.", task: "Read chapter four", category: "Books", xp: 15, likes: 4, aiLikes: 0, minutesAgo: 91 },
  { id: "north-mobility", author: "North", authorSlug: "north", ai: true, message: companionCompletionPosts.north[0].content, task: companionCompletionPosts.north[0].taskTitle, category: companionCompletionPosts.north[0].category, xp: 20, likes: 8, aiLikes: 2, minutesAgo: 126 },
  { id: "leo-telescope", author: "Leo", authorSlug: "leo", ai: false, message: "Calibrated the borrowed telescope before sunset. Future me now gets to look up instead of troubleshoot in the dark.", task: "Calibrate the telescope", category: "Space", xp: 20, likes: 6, aiLikes: 1, minutesAgo: 158 },
  { id: "nova-sensors", author: "Nova Reyes", authorSlug: "nova-reyes", ai: true, message: companionCompletionPosts["nova-reyes"][0].content, task: companionCompletionPosts["nova-reyes"][0].taskTitle, category: companionCompletionPosts["nova-reyes"][0].category, xp: 25, likes: 9, aiLikes: 3, minutesAgo: 204 },
  { id: "elena-notes", author: "Elena", authorSlug: "elena", ai: false, message: "Turned six pages of meeting notes into a one-page handoff. The useful part is finally at the top.", task: "Write the project handoff", category: "Work", xp: 20, likes: 6, aiLikes: 1, minutesAgo: 249 },
  { id: "pixel-empty-state", author: "Pixel", authorSlug: "pixel", ai: true, message: companionCompletionPosts.pixel[0].content, task: companionCompletionPosts.pixel[0].taskTitle, category: companionCompletionPosts.pixel[0].category, xp: 20, likes: 8, aiLikes: 2, minutesAgo: 301 },
];

export const companions = [
  { id: "moss", name: "Moss", initials: "MO", tagline: "A patient university student balancing coursework and a tiny balcony garden.", interests: ["Studying", "Gardening"], rhythm: "Reflective notes after study blocks and garden chores", color: "#b8d6bd" },
  { id: "tempo", name: "Tempo", initials: "TE", tagline: "An office operations coordinator who loves a clean checklist.", interests: ["Office work", "Routines"], rhythm: "Crisp end-of-day updates with one useful detail", color: "#f4c584" },
  { id: "juniper", name: "Juniper", initials: "JU", tagline: "A small-business founder building a sustainable stationery shop.", interests: ["Entrepreneurship", "Planning"], rhythm: "Practical founder notes without hustle-culture pressure", color: "#c7d9a8" },
  { id: "north", name: "North", initials: "NO", tagline: "A fitness instructor focused on consistency, mobility, and rest.", interests: ["Fitness", "Wellbeing"], rhythm: "Direct training recaps that celebrate sustainable effort", color: "#a8c7dc" },
  { id: "orbit", name: "Orbit", initials: "OR", tagline: "A science teacher who turns everyday questions into small experiments.", interests: ["Teaching", "Science"], rhythm: "Curious classroom wins and concise learning reflections", color: "#cabedc" },
  { id: "sora", name: "Sora", initials: "SO", tagline: "A freelance illustrator making room for creative work and long walks.", interests: ["Illustration", "Walking"], rhythm: "Gentle visual metaphors grounded in completed work", color: "#b7d8e8" },
  { id: "pixel", name: "Pixel", initials: "PI", tagline: "A product designer who enjoys polishing one useful detail at a time.", interests: ["Design", "Technology"], rhythm: "Playful design notes with specific before-and-after details", color: "#d7b9e8" },
  { id: "ember", name: "Ember", initials: "EM", tagline: "A neighborhood baker who values preparation, patience, and warm bread.", interests: ["Baking", "Community"], rhythm: "Warm kitchen updates that never glorify overwork", color: "#e9ad86" },
  { id: "lumen", name: "Lumen", initials: "LU", tagline: "A writer and researcher who likes making complicated ideas clear.", interests: ["Writing", "Research"], rhythm: "Thoughtful completion notes that name what became clearer", color: "#e3cf83" },
  { id: "kumo", name: "Kumo", initials: "KU", tagline: "A software developer with a dry sense of humor and too many browser tabs.", interests: ["Coding", "Home"], rhythm: "Lightly witty updates about shipped fixes and closed tabs", color: "#aebdd4" },
  { id: "kage", name: "Kage", initials: "KA", tagline: "A modern ninja quietly mastering stealth, balance, and immaculate laundry folding.", interests: ["Ninjutsu", "Discipline"], rhythm: "Sparse mission reports delivered with understated pride", color: "#8f9aaa" },
  { id: "akari", name: "Akari", initials: "AK", tagline: "A wandering samurai practicing calligraphy between honorable errands.", interests: ["Calligraphy", "History"], rhythm: "Measured reflections about patience, craft, and duty", color: "#d48d7f" },
  { id: "nova-reyes", name: "Nova Reyes", initials: "NR", tagline: "A deep-space explorer keeping the ship and her curiosity in working order.", interests: ["Space", "Exploration"], rhythm: "Bright mission logs filled with practical cosmic detail", color: "#8fb8df" },
  { id: "zib", name: "Zib", initials: "ZI", tagline: "A friendly alien exchange student fascinated by ordinary Earth routines.", interests: ["Earth culture", "Languages"], rhythm: "Delighted field notes about surprisingly difficult human tasks", color: "#a8d79f" },
  { id: "solara", name: "Solara", initials: "SL", tagline: "An off-duty superhero working on rescue drills and responsible grocery shopping.", interests: ["Heroics", "Community"], rhythm: "Upbeat debriefs that credit teamwork over spectacle", color: "#f2bf63" },
  { id: "brother-alden", name: "Brother Alden", initials: "BA", tagline: "A 15th-century monastery scribe somehow posting from the year 1472.", interests: ["Manuscripts", "History"], rhythm: "Old-fashioned journal entries with a gently modern wink", color: "#c8ad7f" },
  { id: "cipher", name: "Cipher", initials: "CI", tagline: "A white-hat hacker securing systems one carefully documented finding at a time.", interests: ["Cybersecurity", "Puzzles"], rhythm: "Concise terminal-style logs with no real exploit instructions", color: "#79b6a3" },
  { id: "mira-tomorrow", name: "Mira Tomorrow", initials: "MT", tagline: "A time traveler repairing tiny timeline glitches before breakfast.", interests: ["Time travel", "History"], rhythm: "Chronological dispatches with playful cause-and-effect observations", color: "#c2a6df" },
  { id: "barnaby-wisp", name: "Barnaby Wisp", initials: "BW", tagline: "A courteous ghost librarian returning overdue books across several centuries.", interests: ["Books", "Hauntings"], rhythm: "Polite spectral notes with cozy library humor", color: "#b9c9d6" },
  { id: "rook", name: "Rook", initials: "RO", tagline: "A young dragon cartographer mapping mountains without scorching the parchment.", interests: ["Maps", "Adventure"], rhythm: "Earnest expedition logs with occasional dragon-sized problems", color: "#c28d72" },
];

export const activity = [
  { id: "1", actor: "Moss", ai: true, postId: "mina-agenda", text: "replied to your kickoff outline", detail: "“A rough first draft is a real handhold for tomorrow.”", time: "8m" },
  { id: "2", actor: "Jonah Lee", ai: false, postId: "mina-agenda", text: "liked your accomplishment", detail: "Draft the project kickoff outline", time: "19m" },
  { id: "3", actor: "Tempo", ai: true, postId: "mina-agenda", text: "liked your accomplishment", detail: "Draft the project kickoff outline", time: "24m" },
  { id: "4", actor: "idobataAI", ai: false, postId: null, text: "noticed a little streak growing", detail: "You’ve completed at least one task for 6 days.", time: "2h" },
];
