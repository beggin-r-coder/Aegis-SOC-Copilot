FROM python:3.11-slim

WORKDIR /srv/triage-service

COPY triage-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY triage-service/ /srv/triage-service/
COPY data/ /srv/data/

ENV AEGIS_DATA_DIR=/srv/data

EXPOSE 8000

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
