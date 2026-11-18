package com.aegis.incident;

import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class EventBusTest {
    static class TestEmitter extends SseEmitter {
        int sends;
        boolean fail;
        Runnable completion;
        SseEventBuilder last;

        @Override
        public void send(SseEventBuilder event) throws IOException {
            sends++;
            if (fail) throw new IOException("disconnected");
            last = event;
        }

        @Override
        public void onCompletion(Runnable callback) { completion = callback; }
    }

    @Test
    void subscriptionsHaveNoTimeout() {
        assertThat(new EventBus().subscribe().getTimeout()).isZero();
    }

    @Test
    void subscribingImmediatelySendsACommentToOpenTheConnection() {
        TestEmitter emitter = new TestEmitter();
        new EventBus(() -> emitter).subscribe();
        assertThat(emitter.sends).isEqualTo(1);
        assertThat(emitter.last.build()).anySatisfy(part ->
                assertThat(part.getData().toString()).contains(":connected"));
    }

    @Test
    void failedSubscribersAreDroppedWithoutPreventingOtherDeliveries() {
        TestEmitter broken = new TestEmitter();
        broken.fail = true;
        TestEmitter healthy = new TestEmitter();
        AtomicInteger created = new AtomicInteger();
        EventBus bus = new EventBus(() -> created.getAndIncrement() == 0 ? broken : healthy);
        bus.subscribe();
        bus.subscribe();
        bus.publish("incident", "first payload");
        bus.publish("cleared", "second payload");
        assertThat(broken.sends).isEqualTo(1);
        assertThat(healthy.sends).isEqualTo(3);
        assertThat(healthy.last.build()).anySatisfy(part -> assertThat(part.getData()).isEqualTo("second payload"));
    }

    @Test
    void completedSubscribersAreRemoved() {
        TestEmitter emitter = new TestEmitter();
        EventBus bus = new EventBus(() -> emitter);
        bus.subscribe();
        emitter.completion.run();
        bus.publish("incident", "payload");
        assertThat(emitter.sends).isEqualTo(1);
    }
}
