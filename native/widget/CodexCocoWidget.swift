import Foundation
import SwiftUI
import WidgetKit

struct SharedMetric: Decodable { let label: String; let value: String; let detail: String }
struct SharedModule: Decodable { let id: String; let title: String; let phase: String; let description: String; let capturedAt: Double?; let metrics: [SharedMetric]? }
struct SharedSnapshot: Decodable { let version: Int; let appRunning: Bool; let capturedAt: Double; let items: [SharedModule] }
struct CodexCocoEntry: TimelineEntry { let date: Date; let snapshot: SharedSnapshot? }

struct CodexCocoProvider: TimelineProvider {
    func placeholder(in context: Context) -> CodexCocoEntry { CodexCocoEntry(date: Date(), snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (CodexCocoEntry) -> Void) { completion(read()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<CodexCocoEntry>) -> Void) {
        completion(Timeline(entries: [read()], policy: .after(Date().addingTimeInterval(15 * 60))))
    }
    private func read() -> CodexCocoEntry {
        let group = Bundle.main.object(forInfoDictionaryKey: "CodexCocoAppGroup") as? String ?? "group.dev.codex-coco.desktop"
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
              let data = try? Data(contentsOf: container.appendingPathComponent("codex-coco-widget.json")), data.count <= 256 * 1024,
              let snapshot = try? JSONDecoder().decode(SharedSnapshot.self, from: data), snapshot.version == 1 else {
            return CodexCocoEntry(date: Date(), snapshot: nil)
        }
        return CodexCocoEntry(date: Date(), snapshot: snapshot)
    }
}

struct CodexCocoWidgetView: View {
    let entry: CodexCocoEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Codex Coco").font(.headline)
            if let snapshot = entry.snapshot, snapshot.appRunning {
                if let usage = snapshot.items.first(where: { $0.id == "usage" }) {
                    if usage.phase == "running", let metrics = usage.metrics, !metrics.isEmpty {
                        ForEach(Array(metrics.prefix(2).enumerated()), id: \.offset) { _, metric in
                            HStack { Text(metric.label).font(.caption); Spacer(); Text(metric.value).bold() }
                        }
                        if let capturedAt = usage.capturedAt {
                            Text(Date(timeIntervalSince1970: capturedAt / 1000), style: .relative).font(.caption2).foregroundStyle(.secondary)
                            if entry.date.timeIntervalSince1970 - capturedAt / 1000 > 15 * 60 { Text("记录已过期，请刷新确认").font(.caption2) }
                        }
                    } else { Text(usage.description).font(.caption) }
                } else { Text("请在主窗口读取用量").font(.caption) }
            } else { Text("请打开 Codex Coco 并开启共享快照").font(.caption) }
        }.containerBackground(.fill.tertiary, for: .widget)
    }
}

@main
struct CodexCocoWidget: Widget {
    let kind = "CodexCocoWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CodexCocoProvider()) { entry in CodexCocoWidgetView(entry: entry) }
            .configurationDisplayName("Codex Coco")
            .description("查看最近一次读取的公开额度与恢复状态。")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
