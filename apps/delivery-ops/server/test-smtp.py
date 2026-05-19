import smtplib
from email.mime.text import MIMEText
import socket

# SMTP Configuration from server/.env
smtp_server = "secure-mailrelay.corp.nutanix.com"
port = 587
username = "svc.ndb.team@nutanix.com"
password = "26@t3Mb4rwy1%#cO"

# Email content
msg = MIMEText("This is a test email from the NDB status sender SMTP configuration.")
msg["Subject"] = "SMTP Test - NDB Status Sender"
msg["From"] = "sakthivel.subburaja@nutanix.com"
msg["To"] = "sakthivel.subburaja@nutanix.com"

# Set socket timeout to prevent hanging
socket.setdefaulttimeout(30)

try:
    print(f"Connecting to {smtp_server}:{port}...")
    server = smtplib.SMTP(smtp_server, port, timeout=30)
    
    print("Starting TLS...")
    server.starttls()
    
    print(f"Logging in as {username}...")
    server.login(username, password)
    
    print("Sending email...")
    server.send_message(msg)
    
    print("Closing connection...")
    server.quit()

    print("\n✓ Email sent successfully!")

except smtplib.SMTPAuthenticationError as e:
    print(f"✗ Authentication failed: {e}")
except smtplib.SMTPException as e:
    print(f"✗ SMTP error occurred: {e}")
except socket.timeout:
    print(f"✗ Connection timeout - unable to reach {smtp_server}:{port}")
except socket.gaierror as e:
    print(f"✗ DNS resolution failed for {smtp_server}: {e}")
except Exception as e:
    print(f"✗ SMTP test failed: {e}")
