package com.aegis.incident;

import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Supplier;

@Component
public class EventBus {
    private final List<SseEmitter> subscribers = new CopyOnWriteArrayList<>();
    private final Supplier<SseEmitter> emitterFactory;

    public EventBus() {
        this(() -> new SseEmitter(0L));
    }

    EventBus(Supplier<SseEmitter> emitterFactory) {
        this.emitterFactory = emitterFactory;
    }

    public SseEmitter subscribe() {
        SseEmitter emitter = emitterFactory.get();
        emitter.onCompletion(() -> subscribers.remove(emitter));
        emitter.onTimeout(() -> subscribers.remove(emitter));
        emitter.onError(error -> subscribers.remove(emitter));
        subscribers.add(emitter);
        try {
            // Flush headers immediately, even before the first incident exists.
            emitter.send(SseEmitter.event().comment("connected"));
        } catch (Exception exception) {
            disconnect(emitter, exception);
        }
        return emitter;
    }

    public void publish(String eventName, Object payload) {
        for (SseEmitter emitter : subscribers) {
            try {
                emitter.send(SseEmitter.event().name(eventName).data(payload));
            } catch (Exception exception) {
                disconnect(emitter, exception);
            }
        }
    }

    private void disconnect(SseEmitter emitter, Exception exception) {
        subscribers.remove(emitter);
        try {
            emitter.completeWithError(exception);
        } catch (RuntimeException ignored) {
            // An already closed response needs no further cleanup.
        }
    }

}
