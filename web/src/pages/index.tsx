import { PagePlaceholder } from '@/components/PagePlaceholder'

// Placeholders until each phase builds the real page (see BUILD_GUIDE.md Section 8).

export const Dashboard = () => (
  <PagePlaceholder title="Dashboard" description="Followers, 30-day views and reach, top Reels, latest outliers." phase={3} />
)
export const Publish = () => (
  <PagePlaceholder title="Publish" description="Upload a Reel or Trial Reel and post it now." phase={3} />
)
export const Insights = () => (
  <PagePlaceholder title="Insights" description="Kevin's Reels with reach, saves, shares and watch time." phase={3} />
)
export const Creators = () => (
  <PagePlaceholder title="Creators" description="Track niche creators and scrape their Reels." phase={2} />
)
export const Outliers = () => (
  <PagePlaceholder title="Outliers" description="Reels that beat their creator's median views." phase={2} />
)
export const AI = () => (
  <PagePlaceholder title="AI" description="Ask the content strategist about Kevin's Reels and outliers." phase={4} />
)
