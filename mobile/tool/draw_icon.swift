// Regenerate: swift tool/draw_icon.swift "$PWD/assets/icon" && dart run flutter_launcher_icons
// Draws the app icon: an open handbook with a bookmark, on the brand blue.
// Same drawing as BrandMark in lib/ui/theme.dart. Plain shapes only.
import AppKit

let blue = NSColor(red: 0x35/255, green: 0x57/255, blue: 0xD4/255, alpha: 1)
let ribbon = NSColor(red: 0xFF/255, green: 0xC4/255, blue: 0x3D/255, alpha: 1)

func render(_ path: String, background: Bool) {
  let size = 1024
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let ctx = NSGraphicsContext.current!.cgContext
  let s = CGFloat(size)
  // Unit coordinates with y pointing down, like the Flutter painter.
  func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: (1 - y) * s) }

  if background {
    ctx.setFillColor(blue.cgColor)
    ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
  }

  func fill(_ points: [(CGFloat, CGFloat)], _ color: NSColor) {
    let path = CGMutablePath()
    path.move(to: p(points[0].0, points[0].1))
    for pt in points.dropFirst() { path.addLine(to: p(pt.0, pt.1)) }
    path.closeSubpath()
    ctx.setFillColor(color.cgColor); ctx.addPath(path); ctx.fillPath()
  }
  // An open book: two pages meeting at the spine, and a bookmark ribbon.
  fill([(0.19, 0.30), (0.48, 0.35), (0.48, 0.75), (0.19, 0.70)], .white)
  fill([(0.52, 0.35), (0.81, 0.30), (0.81, 0.70), (0.52, 0.75)], .white)
  fill([(0.63, 0.31), (0.73, 0.296), (0.73, 0.55), (0.68, 0.51), (0.63, 0.55)], ribbon)

  NSGraphicsContext.current = nil
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

render(CommandLine.arguments[1] + "/icon.png", background: true)
render(CommandLine.arguments[1] + "/icon-foreground.png", background: false)
