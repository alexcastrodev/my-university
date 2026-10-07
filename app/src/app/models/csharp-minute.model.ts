import { JavaMinuteEpisode, JavaMinuteEpisodeSummary } from './java-minute.model';

/** C# Minute episodes have exactly the Java Minute shape (the backend serves both from one base service). */
export type CSharpMinuteEpisodeSummary = JavaMinuteEpisodeSummary;
export type CSharpMinuteEpisode = JavaMinuteEpisode;
