import sys
import json
import os
from pytubefix import YouTube

def get_info(url, po_token=None, visitor_data=None):
    try:
        def verifier(arg=None):
            return visitor_data, po_token
            
        yt = YouTube(
            url, 
            use_po_token=True if po_token else False, 
            po_token_verifier=verifier if po_token else None
        )
        
        formats = []
        for s in yt.streams:
            formats.append({
                "format_id": str(s.itag),
                "ext": s.mime_type.split('/')[-1] if '/' in s.mime_type else s.mime_type,
                "resolution": s.resolution or ("audio" if s.includes_audio_track and not s.includes_video_track else "unknown"),
                "filesize": s.filesize,
                "vcodec": s.video_codec if s.includes_video_track else "none",
                "acodec": s.audio_codec if s.includes_audio_track else "none",
                "note": f"{'Progressive' if s.is_progressive else 'DASH'} {s.type}"
            })

        info = {
            "title": yt.title,
            "thumbnail": yt.thumbnail_url,
            "duration": yt.length,
            "uploader": yt.author,
            "platform": "YouTube (pytubefix)",
            "formats": formats
        }
        return info
    except Exception as e:
        return {"error": str(e)}

def download(url, itag, output_path, po_token=None, visitor_data=None):
    try:
        def verifier(arg=None):
            return visitor_data, po_token

        yt = YouTube(
            url, 
            use_po_token=True if po_token else False, 
            po_token_verifier=verifier if po_token else None
        )
        
        # If itag is 'best', find the best adaptive video or progressive
        if itag == 'best':
            stream = yt.streams.filter(progressive=True, file_extension='mp4').order_by('resolution').desc().first()
            if not stream:
                stream = yt.streams.filter(adaptive=True, file_extension='mp4', only_video=True).order_by('resolution').desc().first()
        else:
            stream = yt.streams.get_by_itag(int(itag))
            
        if not stream:
            # Fallback to best progressive if itag not found
            stream = yt.streams.filter(progressive=True, file_extension='mp4').order_by('resolution').desc().first()
        
        if not stream:
            return {"error": "No suitable stream found"}
            
        # Check if we need to merge (DASH video without audio)
        if stream.includes_video_track and not stream.includes_audio_track:
            # It's a DASH video stream, we need audio
            audio_stream = yt.streams.filter(only_audio=True).order_by('abr').desc().first()
            if audio_stream:
                print(f"[INFO] DASH video detected (itag={stream.itag}), downloading audio (itag={audio_stream.itag}) for merging...", file=sys.stderr)
                
                v_path = stream.download(output_path=os.path.dirname(output_path), filename="video_tmp")
                a_path = audio_stream.download(output_path=os.path.dirname(output_path), filename="audio_tmp")
                
                final_path = output_path
                # Use ffmpeg to merge
                import subprocess
                cmd = [
                    'ffmpeg', '-y',
                    '-i', v_path,
                    '-i', a_path,
                    '-c:v', 'copy',
                    '-c:a', 'aac',
                    '-strict', 'experimental',
                    final_path
                ]
                try:
                    subprocess.run(cmd, check=True, capture_output=True)
                    # Cleanup
                    os.remove(v_path)
                    os.remove(a_path)
                    return {"path": final_path}
                except Exception as merge_err:
                    print(f"[ERROR] Merge failed: {merge_err}", file=sys.stderr)
                    # If merge fails, return the video-only path as better than nothing? 
                    # Actually, rename it to output_path so the server finds it
                    os.rename(v_path, output_path)
                    if os.path.exists(a_path): os.remove(a_path)
                    return {"path": output_path, "warning": "merge failed, video only"}

        # Normal download for progressive or audio-only
        path = stream.download(output_path=os.path.dirname(output_path), filename=os.path.basename(output_path))
        return {"path": path}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python pytube_helper.py <mode> <url> [itag] [output_path] [po_token] [visitor_data]")
        sys.exit(1)
        
    mode = sys.argv[1]
    url = sys.argv[2]
    
    # Optional arguments for PO Token
    po_token = sys.argv[5] if len(sys.argv) > 5 else None
    visitor_data = sys.argv[6] if len(sys.argv) > 6 else None
    
    if mode == "info":
        res = get_info(url, po_token, visitor_data)
        if "error" in res:
            print(json.dumps(res), file=sys.stderr)
            sys.exit(1)
        print(json.dumps(res))
    elif mode == "download":
        if len(sys.argv) < 5:
            print("Missing itag or output_path for download mode")
            sys.exit(1)
        itag = sys.argv[3]
        out = sys.argv[4]
        res = download(url, itag, out, po_token, visitor_data)
        if "error" in res:
            print(json.dumps(res), file=sys.stderr)
            sys.exit(1)
        print(json.dumps(res))
