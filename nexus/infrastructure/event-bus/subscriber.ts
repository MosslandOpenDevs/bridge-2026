/**
 * Event Subscriber
 * 
 * 이벤트를 구독하는 인터페이스와 구현입니다.
 */

// EventType은 subscribeAll에서 값으로도 쓰이므로(Object.values) 타입 전용
// import으로 가져올 수 없다.
import { EventType } from './event-types';
import type { Event, EventOf } from './event-types';
import { eventPublisher } from './publisher';

/**
 * 이벤트 핸들러 타입
 */
export type EventHandler<T extends Event = Event> = (event: T) => void | Promise<void>;

/**
 * 발행된 이벤트가 구독한 타입의 이벤트인지 확인합니다.
 *
 * Publisher가 구독 키별로 라우팅하므로 실패할 일은 없지만, 컴파일러가 Event
 * 유니온을 핸들러가 선언한 타입으로 좁히는 근거는 이 런타임 검사뿐이다.
 */
function isEventOf<K extends EventType>(event: Event, eventType: K): event is EventOf<K> {
  return event.type === eventType;
}

/**
 * 이벤트 구독자 인터페이스
 */
export interface IEventSubscriber {
  /**
   * 이벤트를 구독합니다.
   * @param eventType 구독할 이벤트 타입
   * @param handler 이벤트 핸들러
   * @returns 구독 해제 함수
   */
  subscribe<K extends EventType>(
    eventType: K,
    handler: EventHandler<EventOf<K>>
  ): () => void;

  /**
   * 여러 이벤트 타입을 구독합니다.
   * @param eventTypes 구독할 이벤트 타입 배열
   * @param handler 이벤트 핸들러
   * @returns 구독 해제 함수
   */
  subscribeMany<K extends EventType>(
    eventTypes: readonly K[],
    handler: EventHandler<EventOf<K>>
  ): () => void;

  /**
   * 모든 이벤트를 구독합니다.
   * @param handler 이벤트 핸들러
   * @returns 구독 해제 함수
   */
  subscribeAll(handler: EventHandler<Event>): () => void;
}

/**
 * 이벤트 구독자 구현
 */
export class EventSubscriber implements IEventSubscriber {
  // 저장하는 것은 호출자의 핸들러가 아니라 등록된 래퍼다. subscribeMany는 같은
  // 핸들러를 여러 타입에 등록하고 같은 타입에 같은 핸들러를 두 번 구독할 수도
  // 있는데, 핸들러 자체를 넣으면 Set이 이를 하나로 합쳐 한 번의 구독 해제가
  // 나머지 구독까지 끊는다.
  private handlers: Map<EventType, Set<EventHandler<Event>>> = new Map();

  subscribe<K extends EventType>(
    eventType: K,
    handler: EventHandler<EventOf<K>>
  ): () => void {
    const dispatch: EventHandler<Event> = (event) => {
      if (!isEventOf(event, eventType)) {
        return;
      }
      return handler(event);
    };

    // Publisher에 핸들러 등록
    eventPublisher._subscribe(eventType, dispatch);

    // 내부 추적을 위해 저장
    let registered = this.handlers.get(eventType);
    if (!registered) {
      registered = new Set();
      this.handlers.set(eventType, registered);
    }
    registered.add(dispatch);

    // 구독 해제 함수 반환
    return () => {
      eventPublisher._unsubscribe(eventType, dispatch);
      this.handlers.get(eventType)?.delete(dispatch);
    };
  }

  subscribeMany<K extends EventType>(
    eventTypes: readonly K[],
    handler: EventHandler<EventOf<K>>
  ): () => void {
    const unsubscribeFunctions = eventTypes.map(eventType =>
      this.subscribe(eventType, handler)
    );

    // 모든 구독을 해제하는 함수 반환
    return () => {
      unsubscribeFunctions.forEach(unsubscribe => unsubscribe());
    };
  }

  subscribeAll(handler: EventHandler<Event>): () => void {
    const allEventTypes = Object.values(EventType);
    return this.subscribeMany(allEventTypes, handler);
  }
  
  /**
   * 모든 구독을 해제합니다.
   */
  unsubscribeAll(): void {
    this.handlers.forEach((handlers, eventType) => {
      handlers.forEach(handler => {
        eventPublisher._unsubscribe(eventType, handler);
      });
    });
    this.handlers.clear();
  }
}

/**
 * 싱글톤 이벤트 구독자 인스턴스
 */
export const eventSubscriber = new EventSubscriber();









